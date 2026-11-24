import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, TimeoutError, firstValueFrom, timeout } from 'rxjs';

/**
 * What every call resolves to: the answer's body, or a refusal with its
 * HTTP status and the server's own short phrase (docs/schemas.md section
 * 9.4). A call never throws over an answer. `status` is 0 when nothing came
 * back: the server is down, the network is, or the answer took longer than
 * ANSWER_MS. `phrase` is empty when the answer carried none.
 */
export type ApiResult<T> = { ok: true; body: T } | Refusal;

export interface Refusal {
  ok: false;
  status: number;
  phrase: string;
}

/** GET /api/session: is there an owner, is this browser signed in. */
export interface SessionAnswer {
  owner: boolean;
  signedIn: boolean;
}

/** A challenge for a sign-in: 64 hex characters, and the relying-party id the passkey call names. */
export interface SignInChallenge {
  challenge: string;
  rpId: string;
}

/** A challenge for a new passkey: also the owner's user handle, 32 hex characters, and the ids of the passkeys there are, base64url, which the device must not hold already. */
export interface NewPasskeyChallenge extends SignInChallenge {
  userHandle: string;
  exclude: string[];
}

/** One passkey of the list (GET /api/passkeys). `lastUsedAt` is null for one that has not signed in; `thisSession` is true for the one this browser signed in with. */
export interface PasskeyItem {
  id: number;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  thisSession: boolean;
}

/** The numbers on top (docs/schemas.md section 6.5). The last three are null for a sweep that reached nobody or had no voters. */
export interface Network {
  active: number;
  counted: number;
  floor: number;
  keyholdersUp: number;
  position: number | null;
  recordHash: string | null;
  leader: number | null;
}

/** One entry of the problems: an active validator whose shown state is not good. */
export interface Problem {
  validatorId: number;
  state: string;
  since: string;
}

/** The doorman's own fields of the newest sweep. Each is null when the answer did not carry it. */
export interface Doorman {
  commit: string | null;
  registryHash: string | null;
  registryActive: number | null;
  uptimeSeconds: number | null;
  certificateDaysLeft: number | null;
  certificateNotAfter: string | null;
}

/** The validator's own fields of the newest sweep. */
export interface Worker {
  status: string | null;
  commit: string | null;
  registryHash: string | null;
  uptimeSeconds: number | null;
  dbMs: number | null;
  counted: boolean | null;
  position: number | null;
  recordHash: string | null;
  leader: number | null;
  ignored: number[] | null;
}

/** The keyholder's own fields of the newest sweep. */
export interface Keyholder {
  answerMs: number;
  status: string | null;
  commit: string | null;
  uptimeSeconds: number | null;
  dbMs: number | null;
  copiesWaiting: number | null;
}

/**
 * One registry row as the overview carries it (docs/schemas.md section 10).
 * `state` is the key of what the screen shows: one of the eleven states,
 * `notActive` for a row with `active` false, or null while no sweep has
 * judged the row. An inactive row carries its id, `active` and `state` and
 * nothing else, so every other field can be missing. In an active row they
 * are there, and null where nothing is known: `doorman` when port 3000 gave
 * no answer, with the short reason in `reason`; `worker` and `keyholder`
 * when there was none; `keyholderUp` for a row with no keyholder check.
 * `version` is the name of the version of the validator's code that its
 * commit is, "v3" (section 19.3): null when the commit has no version tag
 * or is not known, and missing in an answer of a server from before the
 * versions were built.
 */
export interface Validator {
  id: number;
  active: boolean;
  state: string | null;
  address?: string;
  since?: string | null;
  keyholderUp?: boolean | null;
  answerMs?: number | null;
  reason?: string | null;
  doorman?: Doorman | null;
  worker?: Worker | null;
  keyholder?: Keyholder | null;
  version?: string | null;
}

/**
 * One of our own servers as the overview carries it (docs/schemas.md
 * section 18.4). `kind` is masterpod, wallet, signer or monitor; `name` is
 * what its tile says; `address` is the place that is asked, null for the
 * monitor itself. `state` is the key of what the screen shows (section
 * 18.2), `since` when that began, and `detail` one short line that says
 * what was seen, which may be empty. The three are null until the first
 * judged sweep after a start.
 */
export interface OwnServer {
  kind: string;
  name: string;
  address: string | null;
  state: string | null;
  since: string | null;
  detail: string | null;
}

/** One program of the software line: the commit most validators run, how many run it, GitHub main's newest commit (40 characters, or null until a read worked), and whether GitHub's begins with the usual one. */
export interface Program {
  commit: string | null;
  running: number;
  main: string | null;
  same: boolean;
}

/** The software line's facts. `readAt` is the oldest of the three reads from GitHub, null until all three have worked once. */
export interface Software {
  readAt: string | null;
  validator: Program;
  doorman: Program;
  keyholder: Program;
}

/** The registry line's facts: GitHub main's registry beside the hash most validators report, which is null when none is known. */
export interface RegistryFacts {
  hash: string;
  rows: number;
  active: number;
  fetchedAt: string;
  usual: string | null;
  same: boolean;
}

/**
 * GET /api/overview: the whole screen in one answer (docs/schemas.md
 * section 10). Until the first sweep after a start has ended, `sweptAt`,
 * `tookMs` and `network` are null. While no registry is there at all,
 * `registryRead` is false, `validators` is empty and `registry` is null.
 * `servers` is our own servers, in the order the screen shows them.
 */
export interface Overview {
  sweptAt: string | null;
  tookMs: number | null;
  registryRead: boolean;
  reachedNobody: boolean;
  stale: boolean;
  network: Network | null;
  problems: Problem[];
  validators: Validator[];
  servers: OwnServer[];
  software: Software;
  registry: RegistryFacts | null;
}

/** One row of a validator's history: a stretch of time it spent in a state. `detail` is one short line about the moment the state began, and may be empty; `endedAt` is null for the state it is in now. */
export interface HistoryRow {
  state: string;
  detail: string;
  startedAt: string;
  endedAt: string | null;
}

/** How long a call may take, in milliseconds. Past it the call counts as not answered, so a screen left open says that the server does not answer and does not wait for ever. */
const ANSWER_MS = 20_000;

/** The server's phrase for a request that needs the session and has none. */
const NOT_SIGNED_IN = 'not signed in';

/** The phrase of a refusal: the `error` of its JSON body, or empty for a body that carries none, an error page of nginx for one. */
function phraseOf(body: unknown): string {
  return typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' ? body.error : '';
}

/**
 * The calls to the monitor's server (docs/schemas.md sections 9.4 and 10),
 * one method for each route, all on the page's own origin under /api. The
 * session is a cookie the page's scripts cannot read; the browser sends it
 * by itself.
 *
 * `signedIn` is what the server last said about this browser: the bar on
 * top shows while it is true. A refusal 401 `not signed in` from any call
 * turns it off and sends the page to /sign-in (section 11.1). The other
 * 401s of the door (a challenge that is used or too old, a passkey the
 * server does not know or does not accept) are refusals of that one
 * request, and the page that made it shows their line.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  /** Whether this browser is signed in, as far as the page knows. False until the server has said so. */
  readonly signedIn = signal(false);

  /** GET /api/session, open to anyone. */
  async session(): Promise<ApiResult<SessionAnswer>> {
    const res = await this.ask(this.http.get<SessionAnswer>('/api/session'));
    if (res.ok) this.signedIn.set(res.body.signedIn);
    return res;
  }

  /** POST /api/passkey/challenge for a sign-in. A challenge is used the first time a request brings it, so every press of a button asks for a new one. */
  signInChallenge(): Promise<ApiResult<SignInChallenge>> {
    return this.ask(this.http.post<SignInChallenge>('/api/passkey/challenge', { purpose: 'signIn' }));
  }

  /** POST /api/passkey/challenge for a new passkey: `create` for the owner's first, while there is none; `add` for one more, signed in. */
  newPasskeyChallenge(purpose: 'create' | 'add'): Promise<ApiResult<NewPasskeyChallenge>> {
    return this.ask(this.http.post<NewPasskeyChallenge>('/api/passkey/challenge', { purpose }));
  }

  /** POST /api/passkey/create: the owner's first passkey. `passkey` is the registration as the passkey service returns it. The answer brings the session cookie. */
  async createOwner(challenge: string, passkey: Record<string, unknown>, label: string): Promise<ApiResult<{ signedIn: boolean }>> {
    const res = await this.ask(this.http.post<{ signedIn: boolean }>('/api/passkey/create', { challenge, passkey, label }));
    if (res.ok) this.signedIn.set(true);
    return res;
  }

  /** POST /api/passkey/sign-in. `assertion` is the assertion as the passkey service returns it. The answer brings the session cookie. */
  async signIn(challenge: string, assertion: Record<string, unknown>): Promise<ApiResult<{ signedIn: boolean }>> {
    const res = await this.ask(this.http.post<{ signedIn: boolean }>('/api/passkey/sign-in', { challenge, assertion }));
    if (res.ok) this.signedIn.set(true);
    return res;
  }

  /** POST /api/passkey/add, signed in: one more passkey. */
  addPasskey(challenge: string, passkey: Record<string, unknown>, label: string): Promise<ApiResult<{ id: number }>> {
    return this.ask(this.http.post<{ id: number }>('/api/passkey/add', { challenge, passkey, label }));
  }

  /** GET /api/passkeys, signed in: the list, oldest first. */
  passkeys(): Promise<ApiResult<{ passkeys: PasskeyItem[] }>> {
    return this.ask(this.http.get<{ passkeys: PasskeyItem[] }>('/api/passkeys'));
  }

  /** DELETE /api/passkeys/:id, signed in. Removing the passkey this browser signed in with ends its session: the next call is refused with 401. */
  removePasskey(id: number): Promise<ApiResult<{ removed: boolean }>> {
    return this.ask(this.http.delete<{ removed: boolean }>(`/api/passkeys/${id}`));
  }

  /** POST /api/sign-out, signed in: the server deletes the session and clears the cookie. */
  async signOut(): Promise<ApiResult<{ signedIn: boolean }>> {
    const res = await this.ask(this.http.post<{ signedIn: boolean }>('/api/sign-out', {}));
    if (res.ok) this.signedIn.set(false);
    return res;
  }

  /** GET /api/overview, signed in. */
  overview(): Promise<ApiResult<Overview>> {
    return this.ask(this.http.get<Overview>('/api/overview'));
  }

  /** GET /api/validators/:id/history, signed in: the validator's last ten states, newest first. */
  history(id: number): Promise<ApiResult<{ history: HistoryRow[] }>> {
    return this.ask(this.http.get<{ history: HistoryRow[] }>(`/api/validators/${id}/history`));
  }

  /** Makes one call and turns what comes of it into an ApiResult. */
  private async ask<T>(call: Observable<T>): Promise<ApiResult<T>> {
    try {
      return { ok: true, body: await firstValueFrom(call.pipe(timeout(ANSWER_MS))) };
    } catch (err) {
      if (err instanceof TimeoutError) return { ok: false, status: 0, phrase: '' };
      if (!(err instanceof HttpErrorResponse)) throw err;
      const phrase = phraseOf(err.error);
      if (err.status === 401 && phrase === NOT_SIGNED_IN) {
        this.signedIn.set(false);
        void this.router.navigateByUrl('/sign-in');
      }
      return { ok: false, status: err.status, phrase };
    }
  }
}
