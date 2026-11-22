import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiService, HistoryRow, Overview, Validator } from '../../services/api.service';
import { Part, clock, minute, words } from '../../words';
import { PartsComponent } from './parts.component';
import { ValidatorDetailsComponent } from './validator-details.component';

/** How often the page asks /api/overview, in milliseconds. */
const ASK_MS = 15_000;

/**
 * GitHub counts as not read when the oldest of its three reads is older
 * than this, in milliseconds: 30 minutes, three times GITHUB_MINUTES at its
 * value of 10. The page does not know the server's setting; the number
 * stands here by hand.
 */
const GITHUB_OLD_MS = 30 * 60_000;

/** The four colours of the screen; each is a class of src/styles.css. */
type Colour = 'green' | 'amber' | 'red' | 'grey';

/** States 1 to 4 (docs/schemas.md section 6.3): the validator does not work for the network. */
const RED = new Set(['noAnswer', 'validatorDown', 'databaseDown', 'notCounted']);

/** States 5 to 10: it works and needs a look. */
const AMBER = new Set(['votedOut', 'outOfStep', 'certificate', 'otherSoftware', 'otherRegistry', 'keyholderDown']);

/** A state's colour. The server gives the key and never a colour. Grey is a row that is not active, and one no sweep has judged yet. */
function colourOf(state: string | null): Colour {
  if (state === 'good') return 'green';
  if (state !== null && RED.has(state)) return 'red';
  if (state !== null && AMBER.has(state)) return 'amber';
  return 'grey';
}

/** Our own servers (docs/schemas.md section 18.2): the states in which one does not work. */
const OWN_RED = new Set(['noAnswer', 'databaseDown', 'closedPage', 'otherAnswer']);

/** The states in which one works. */
const OWN_GREEN = new Set(['answers', 'running']);

/** The colour of a state of our own servers. Grey is `notAsked`, and one no sweep has judged yet. */
function ownColourOf(state: string | null): Colour {
  if (state !== null && OWN_GREEN.has(state)) return 'green';
  if (state !== null && OWN_RED.has(state)) return 'red';
  return 'grey';
}

/** One of the four cards on top: its name, its value, and the small line under the value, or null. */
interface Card {
  label: string;
  value: string;
  under: string | null;
}

/** The line under the cards: its colour and its words. */
interface Notice {
  colour: Colour;
  text: string;
}

/** One tile: the validator's id, what the tile says, and its colour. */
interface Tile {
  id: number;
  says: string;
  colour: Colour;
}

/** One tile of our own servers: its name, what the tile says, its colour, and the hint a mouse shows over it: the address that is asked, with the detail behind it. The monitor itself has no hint. */
interface OwnTile {
  name: string;
  says: string;
  colour: Colour;
  hint: string | null;
}

/**
 * The overview (docs/schemas.md sections 11.4 and 18.5), from top to
 * bottom under the shell's bar: the four cards, the problem line, the
 * tiles of our own servers, the validators' tiles, the details of the
 * tapped tile, the software line and the registry line.
 *
 * The page asks GET /api/overview when it opens and every 15 seconds
 * after. One answer holds the whole screen; everything here is worked out
 * from the newest one. The server gives a state's key, never a colour or a
 * sentence: the colours are in this file, the sentences in words.ts.
 *
 * An ask the server does not answer, or refuses, leaves the screen as it
 * was and puts a red line in place of the problem line, which says from
 * when the screen is. A 401 `not signed in` sends the page to /sign-in as
 * well (the API service does that).
 */
@Component({
  selector: 'app-overview-page',
  imports: [MatCardModule, MatProgressBarModule, PartsComponent, ValidatorDetailsComponent],
  templateUrl: './overview.page.html',
  styleUrl: './overview.page.css',
})
export class OverviewPage {
  private readonly api = inject(ApiService);
  protected readonly w = words;

  /** The newest answer of /api/overview; null until the first has come. */
  protected readonly overview = signal<Overview | null>(null);

  /** The browser's clock at the newest ask, in milliseconds: what "2 hours" and "today" are counted from. */
  protected readonly now = signal(Date.now());

  /** The line for the newest ask when the server did not answer it, or refused it; null when it answered. */
  private readonly failure = signal<string | null>(null);

  /** When the newest answer came, as an ISO text; null before the first. */
  private readonly answeredAt = signal<string | null>(null);

  /** The id of the tapped tile, or null while none is. */
  protected readonly tappedId = signal<number | null>(null);

  /** The tapped validator's last ten states, newest first; null while they are not read. */
  protected readonly history = signal<HistoryRow[] | null>(null);

  /** What the history on screen was asked for: the tapped validator's id, state and since. Empty while nothing is asked for. */
  private historyOf = '';

  /** True while an ask of /api/overview is under way, so a slow answer is not asked for twice. */
  private asking = false;

  /** The four cards: validators counted with the floor, keyholders up, chain position, leader. */
  protected readonly cards = computed<Card[]>(() => {
    const network = this.overview()?.network ?? null;
    const t = words.overview;
    const numberOf = (value: number | null | undefined) => (typeof value === 'number' ? String(value) : words.dash);
    return [
      {
        label: t.counted,
        value: network === null ? words.dash : t.of(network.counted, network.active),
        under: network === null ? null : t.floor(network.floor),
      },
      { label: t.keyholders, value: network === null ? words.dash : t.of(network.keyholdersUp, network.active), under: null },
      { label: t.position, value: numberOf(network?.position), under: null },
      { label: t.leader, value: numberOf(network?.leader), under: null },
    ];
  });

  /**
   * The line under the cards; null until the first ask has ended. The
   * first that fits:
   *
   *   1. the server did not answer the newest ask (red): why, and from
   *      when the screen is
   *   2. no registry read yet (grey)
   *   3. the first sweep after a start has not ended (grey)
   *   4. the newest sweep reached no validator (red)
   *   5. the monitor has not swept for three sweeps' time (red)
   *   6. no problems, among the validators and among our own servers
   *      (green)
   *   7. the problems: the sentences of up to three, then how many more,
   *      then the last sweep's time. Our own servers come first, in the
   *      screen's order; then the validators, as the server orders them,
   *      red before amber. Red when one of our own servers has a problem
   *      or a red state is among the validators', else amber.
   */
  protected readonly notice = computed<Notice | null>(() => {
    const overview = this.overview();
    const now = this.now();
    const t = words.overview;
    const failure = this.failure();
    if (failure !== null) {
      const answeredAt = this.answeredAt();
      return { colour: 'red', text: answeredAt === null ? failure : `${failure} ${t.screenFrom(clock(answeredAt, now))}` };
    }
    if (overview === null) return null;
    if (!overview.registryRead) return { colour: 'grey', text: t.noRegistry };
    if (overview.sweptAt === null) return { colour: 'grey', text: t.firstSweep };
    if (overview.reachedNobody) return { colour: 'red', text: t.reachedNobody };
    const swept = clock(overview.sweptAt, now);
    if (overview.stale) return { colour: 'red', text: t.stale(swept) };
    const { problems, validators } = overview;
    // An answer of a server from before our own servers were built carries
    // no `servers`.
    const own = (overview.servers ?? []).filter(({ state }) => state !== null && OWN_RED.has(state));
    if (problems.length === 0 && own.length === 0) return { colour: 'green', text: t.noProblems(swept) };

    // The certificate's days are the newest sweep's. They are not known when
    // the doorman did not answer that sweep while the screen still shows the
    // state of the sweeps before.
    const all = [
      ...own.map(({ kind, name, address, state, detail }) => words.own.problem(state ?? '', kind, name, address, detail ?? '')),
      ...problems.map(({ validatorId, state }) => {
        const doorman = validators.find(({ id }) => id === validatorId)?.doorman;
        return words.problem(state, validatorId, doorman ? doorman.certificateDaysLeft : undefined);
      }),
    ];
    const sentences = all.slice(0, 3);
    if (all.length > 3) sentences.push(t.more(all.length - 3));
    sentences.push(t.lastSweep(swept));
    return { colour: own.length > 0 || problems.some(({ state }) => RED.has(state)) ? 'red' : 'amber', text: sentences.join(' ') };
  });

  /** The tiles of our own servers, in the order the server gives them. One no sweep has judged yet says a dash. */
  protected readonly ownTiles = computed<OwnTile[]>(() =>
    (this.overview()?.servers ?? []).map(({ name, address, state, detail }) => ({
      name,
      says: state === null ? words.dash : words.own.state(state),
      colour: ownColourOf(state),
      hint: address === null ? null : detail ? `${address}: ${detail}` : address,
    })),
  );

  /** The tiles, one for each registry row, in id order. A row no sweep has judged yet says a dash. */
  protected readonly tiles = computed<Tile[]>(() =>
    (this.overview()?.validators ?? []).map(({ id, state }) => ({
      id,
      says: state === null ? words.dash : words.state(state),
      colour: colourOf(state),
    })),
  );

  /** The tapped validator's entry of the overview, or null. */
  protected readonly tapped = computed<Validator | null>(() => {
    const id = this.tappedId();
    return this.overview()?.validators.find((validator) => validator.id === id) ?? null;
  });

  /**
   * The software line. First what most validators run, when a commit is
   * known. Then what GitHub main says: nothing when GitHub was not read in
   * the last 30 minutes, but the sentence that says so; else "the newest on
   * GitHub main" when all three are, or one sentence for each program
   * GitHub main is ahead of. "All 25" stands only when every active
   * validator runs the three usual commits; else the line says "most", and
   * the others show as amber tiles.
   */
  protected readonly software = computed<Part[]>(() => {
    const overview = this.overview();
    if (overview === null) return [];
    const { software, network } = overview;
    const now = this.now();
    const t = words.software;
    const programs = [
      { name: 'validator', ...software.validator },
      { name: 'doorman', ...software.doorman },
      { name: 'keyholder', ...software.keyholder },
    ] as const;

    const known = programs.some(({ commit }) => commit !== null);
    const all = network !== null && programs.every(({ commit, running }) => commit !== null && running === network.active);
    const read = software.readAt !== null && now - Date.parse(software.readAt) <= GITHUB_OLD_MS;

    const parts: Part[] = [];
    if (known) {
      parts.push(...t.runs(all && network !== null ? network.active : null, software.validator.commit, software.doorman.commit, software.keyholder.commit));
    }
    if (!read) {
      if (known) parts.push({ text: t.stop });
      parts.push({ text: t.notRead(software.readAt === null ? null : minute(software.readAt, now)) });
    } else if (known) {
      if (programs.every(({ same }) => same)) {
        parts.push({ text: t.newest });
      } else {
        parts.push({ text: t.stop });
        for (const { name, commit, main, same } of programs) {
          if (commit !== null && main !== null && !same) parts.push(...t.newer(name, main));
        }
      }
    }
    return parts.length === 0 ? [{ text: t.unknown }] : parts;
  });

  /** The registry line: how many active rows, and whether the validators applied the registry on GitHub main. The second sentence is left out while no validator's hash is known. */
  protected readonly registry = computed<Part[]>(() => {
    const overview = this.overview();
    if (overview === null) return [];
    const { registry } = overview;
    const t = words.registry;
    if (registry === null) return [{ text: t.unknown }];
    const parts: Part[] = [{ text: t.rows(registry.active) }];
    if (registry.usual !== null) {
      parts.push(...(registry.same ? t.applied(registry.hash) : t.differs(registry.hash, registry.usual)));
    }
    return parts;
  });

  constructor() {
    void this.ask();
    const timer = setInterval(() => void this.ask(), ASK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  /** A tap on a tile: its details show under the tiles. */
  protected tap(id: number): void {
    if (id === this.tappedId()) return;
    this.tappedId.set(id);
    this.history.set(null);
    void this.readHistory();
  }

  /**
   * One ask of /api/overview. The answer becomes the screen. No answer, or
   * a refusal, leaves the screen as it was and turns the line under the
   * cards red. After a 401 `not signed in` the page is on its way to
   * /sign-in as well (the API service does that).
   */
  private async ask(): Promise<void> {
    if (this.asking) return;
    this.asking = true;
    try {
      const answer = await this.api.overview();
      this.now.set(Date.now());
      if (!answer.ok) {
        this.failure.set(words.failure(answer.status, answer.phrase));
        return;
      }
      this.failure.set(null);
      this.answeredAt.set(new Date().toISOString());
      this.overview.set(answer.body);
      this.choose(answer.body);
      void this.readHistory();
    } finally {
      this.asking = false;
    }
  }

  /**
   * The tile that is tapped at the start (section 11.4, item 6): the first
   * problem's, or the first row's when there is no problem. Chosen once, at
   * the first answer that carries a sweep, so the choice is made from
   * states that are known. After that only a tap changes it, unless the
   * tapped row has left the registry: then the page chooses again.
   */
  private choose(overview: Overview): void {
    const tapped = this.tappedId();
    if (tapped !== null && overview.validators.some(({ id }) => id === tapped)) return;
    if (tapped === null && overview.sweptAt === null) return;
    this.tappedId.set(overview.problems.at(0)?.validatorId ?? overview.validators.at(0)?.id ?? null);
    this.history.set(null);
  }

  /**
   * Reads the tapped validator's history, when it is not the one on screen:
   * after a tap, and when the validator's state has changed since the last
   * read. An answer that comes after another tile was tapped is dropped. A
   * read that fails is tried again with the next ask of the overview.
   */
  private async readHistory(): Promise<void> {
    const validator = this.tapped();
    if (validator === null) {
      this.historyOf = '';
      return;
    }
    const wanted = `${validator.id} ${validator.state} ${validator.since}`;
    if (wanted === this.historyOf) return;
    this.historyOf = wanted;
    const answer = await this.api.history(validator.id);
    if (this.historyOf !== wanted) return;
    if (answer.ok) this.history.set(answer.body.history);
    else this.historyOf = '';
  }
}
