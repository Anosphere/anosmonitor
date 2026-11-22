import { config } from '../config.js';
import { ask, isObject } from '../sweep/ask.js';
import { twoSweeps } from '../sweep/states.js';

/**
 * Our own servers (docs/schemas.md section 18): the masterpod, the wallet's
 * names and the signing servers, asked in every sweep, and the monitor
 * itself.
 *
 * The monitor stands outside every one of them, so it asks what anyone can
 * ask:
 *
 *   the masterpod        GET <MASTERPOD_URL>/health
 *   each wallet name     GET <name>/api/config, the settings the wallet's
 *                        own page loads
 *   each signing server  GET <the first wallet name>/api/sign/<n>/public-keys,
 *                        which the wallet's server passes on to signing
 *                        server n. A signing server takes requests from the
 *                        two wallet servers and from nobody else.
 *
 * The monitor itself is not asked. While this program runs, its state is
 * `running`.
 *
 * Each has one state at a time, the first that fits.
 *
 *   The masterpod:
 *     noAnswer      no answer, or one that could not be read
 *     answers       HTTP 200, and its status is ok
 *     databaseDown  it answered, and its db.status is not ok
 *     otherAnswer   any other answer
 *
 *   A wallet name:
 *     closedPage    HTTP 503 that could not be read. nginx on the wallet
 *                   server shows the closed page: the wallet is closed, or
 *                   the program behind nginx does not answer
 *     noAnswer      no answer, or any other answer that could not be read
 *     answers       HTTP 200 with a JSON object
 *     otherAnswer   any other answer
 *
 *   A signing server. "The wallet answers" means that the first wallet
 *   name's own state in the same sweep is answers:
 *     notAsked      the question did not get past the wallet: HTTP 503
 *                   that could not be read, which is the wallet server's
 *                   closed page; or no answer, or any other answer that
 *                   could not be read, while the wallet does not answer
 *     noAnswer      no answer, or any other answer that could not be read,
 *                   while the wallet answers; or HTTP 502 with the wallet's
 *                   own word that the signing server is unavailable
 *     answers       HTTP 200 with the two public keys
 *     otherAnswer   any other answer
 *
 * `answers` and `running` are green and `notAsked` is grey. The others are
 * red. With each state goes a detail, one short line that says what was
 * seen. It is empty for `answers`, `running` and `closedPage`.
 *
 * The two-sweep rule (server/sweep/states.js) holds here too: what the
 * screen shows changes when two sweeps in a row work out the same new
 * state. A sweep in which nothing answered at all, no validator and none of
 * these, is not judged: the monitor's own connection may be down, and
 * nothing the screen shows changes.
 *
 * Nothing of this is kept in the database. A change prints one log line,
 * `server signer2: answers -> noAnswer (timeout)`. After a start each one
 * takes the state of its first judged sweep at once, with that sweep's
 * time.
 *
 * The requests are far under every limit: one a minute to the masterpod,
 * whose doormen refuse an address past 50 requests in 10 seconds, and five
 * a minute to the wallet.
 */

/** When this program started: since when the monitor's own entry is `running`. */
const startedAt = new Date(Date.now() - Math.round(process.uptime() * 1000));

/** The first label of an address's host name: `attestor` for https://attestor.wallet.anocloud.com. An address with no host name is taken whole. */
function firstLabel(address) {
  const match = /^[a-z]+:\/\/([^./:]+)/.exec(address);
  return match === null ? address : match[1];
}

/**
 * What is asked, in the order the screen shows it: { kind, name, address,
 * url }. `kind` is masterpod, wallet or signer. `name` is what the tile
 * says. `address` is what the screen names as the place that is asked.
 * `url` is the GET.
 */
const asked = Object.freeze([
  { kind: 'masterpod', name: 'masterpod', address: config.masterpodUrl, url: `${config.masterpodUrl}/health` },
  ...config.walletUrls.map((address) => ({ kind: 'wallet', name: firstLabel(address), address, url: `${address}/api/config` })),
  ...Array.from({ length: config.signingServers }, (unused, i) => {
    const address = `${config.walletUrls[0]}/api/sign/${i + 1}`;
    return { kind: 'signer', name: `signer${i + 1}`, address, url: `${address}/public-keys` };
  }),
]);

// A name is what the screen tells them apart by, so no two may be the same.
// Like every wrong setting, this stops the start.
{
  const names = [...asked.map(({ name }) => name), config.monitorName];
  const twice = names.find((name, i) => names.indexOf(name) !== i);
  if (twice !== undefined) throw new Error(`two of our own servers are called "${twice}": look at WALLET_URLS and MONITOR_NAME`);
}

/**
 * What the screen shows for each one that is asked, by name: { state,
 * since, detail, waiting }. `waiting` is the waiting value of the two-sweep
 * rule, or null. Empty until the first judged sweep.
 */
const shown = new Map();

// ---------------------------------------------------------------------------
// What one answer means.
// ---------------------------------------------------------------------------

/** Why there is no answer to read: `HTTP 503, not JSON` when one came and could not be read, else the short reason alone. */
function unread(answer) {
  return answer.status === undefined ? answer.reason : `HTTP ${answer.status}, ${answer.reason}`;
}

/** An answer's own word for what is wrong: its `code`, its `error.code` or its `error`, the first that is a text, cut at 60 characters. Empty when it has none. */
function wordOf(body) {
  const found = [body.code, isObject(body.error) ? body.error.code : body.error].find(
    (value) => typeof value === 'string' && value !== '',
  );
  return found === undefined ? '' : found.slice(0, 60);
}

/** The state for an answer that is none of the expected ones, with its status and its own word: `HTTP 503, FRONT_NOT_SERVING`. */
function otherAnswer(answer) {
  const word = wordOf(answer.body);
  return { state: 'otherAnswer', detail: word === '' ? `HTTP ${answer.status}` : `HTTP ${answer.status}, ${word}` };
}

/** The masterpod's state in one sweep, from the answer of its /health. */
function masterpodState(answer) {
  if (!answer.answered) return { state: 'noAnswer', detail: unread(answer) };
  const { status, body } = answer;
  if (status === 200 && body.status === 'ok') return { state: 'answers', detail: '' };
  if (isObject(body.db) && body.db.status !== 'ok') {
    const database = typeof body.db.status === 'string' ? body.db.status.slice(0, 40) : 'not given';
    return { state: 'databaseDown', detail: `HTTP ${status}, database ${database}` };
  }
  return otherAnswer(answer);
}

/**
 * A wallet name's state in one sweep, from the answer of its /api/config.
 * HTTP 503 that could not be read is the closed page, whatever its length:
 * nginx on a wallet server answers its own 502, 503 and 504 with that
 * page, as 503.
 */
function walletState(answer) {
  if (!answer.answered) {
    if (answer.status === 503) return { state: 'closedPage', detail: '' };
    return { state: 'noAnswer', detail: unread(answer) };
  }
  if (answer.status === 200) return { state: 'answers', detail: '' };
  return otherAnswer(answer);
}

/**
 * A signing server's state in one sweep, from the answer of its
 * /public-keys through the wallet. `walletAnswers` says whether the first
 * wallet name's own state in this sweep is `answers`.
 *
 * The wallet's server passes on what a signing server sent, status and
 * body as they came. A signing server has nginx in front of its program
 * too: when the program does not answer, that nginx answers 502 with its
 * own page, which is not JSON. So while the wallet answers, an answer that
 * could not be read is the signing server's. The one that is the wallet's
 * own is HTTP 503, its closed page.
 */
function signerState(answer, walletAnswers) {
  if (!answer.answered) {
    if (answer.status === 503) return { state: 'notAsked', detail: `the wallet answered ${unread(answer)}` };
    if (!walletAnswers) {
      const detail = answer.status === undefined ? 'the wallet does not answer' : `the wallet answered ${unread(answer)}`;
      return { state: 'notAsked', detail };
    }
    return { state: 'noAnswer', detail: unread(answer) };
  }
  const { status, body } = answer;
  if (status === 200 && typeof body.walletKey === 'string' && typeof body.walletPostQuantumKey === 'string') {
    return { state: 'answers', detail: '' };
  }
  if (status === 502 && typeof body.error === 'string') {
    return { state: 'noAnswer', detail: `the wallet says: ${body.error.slice(0, 60)}` };
  }
  return otherAnswer(answer);
}

/** The states one sweep works out, in the list's order: [{ state, detail }]. `answers` is what askOwnServers resolved with. */
function workOut(answers) {
  const first = asked.findIndex(({ kind }) => kind === 'wallet');
  const walletAnswers = walletState(answers[first]).state === 'answers';
  return asked.map(({ kind }, i) => {
    if (kind === 'masterpod') return masterpodState(answers[i]);
    if (kind === 'wallet') return walletState(answers[i]);
    return signerState(answers[i], walletAnswers);
  });
}

// ---------------------------------------------------------------------------
// One sweep.
// ---------------------------------------------------------------------------

/** Asks every one of them, all at once. Resolves, and never rejects, with the answers in the list's order (server/sweep/ask.js). */
export function askOwnServers() {
  return Promise.all(asked.map(({ url }) => ask(url)));
}

/**
 * One sweep's answers judged. `answers` is what askOwnServers resolved
 * with, `sweptAt` the sweep's time, and `validatorsReached` how many
 * validators answered in the same sweep.
 *
 * A sweep in which nothing came back from anywhere is not judged. For that,
 * an answer that came and could not be read counts as one that came.
 */
export function judgeOwnServers(answers, sweptAt, validatorsReached) {
  const reached = answers.some((answer) => answer.answered || answer.status !== undefined);
  if (!reached && validatorsReached === 0) return;

  workOut(answers).forEach((worked, i) => {
    const { name } = asked[i];
    const entry = shown.get(name);
    if (entry === undefined) {
      shown.set(name, { state: worked.state, since: sweptAt, detail: worked.detail, waiting: null });
      return;
    }
    const next = twoSweeps(entry.state, entry.waiting, { value: worked.state, detail: worked.detail }, sweptAt);
    if (!next.changed) {
      entry.waiting = next.waiting;
      return;
    }
    console.log(`server ${name}: ${entry.state} -> ${next.value}${next.detail === '' ? '' : ` (${next.detail})`}`);
    entry.state = next.value;
    entry.since = next.since;
    entry.detail = next.detail;
    entry.waiting = null;
  });
}

/**
 * Our own servers as the overview carries them, in the screen's order:
 * [{ kind, name, address, state, since, detail }]. `state`, `since` and
 * `detail` are what the screen shows, and null until the first judged
 * sweep. The last entry is the monitor itself: the kind `monitor`, no
 * address, the state `running`, since this program started.
 */
export function ownServers() {
  return [
    ...asked.map(({ kind, name, address }) => {
      const entry = shown.get(name);
      return {
        kind,
        name,
        address,
        state: entry === undefined ? null : entry.state,
        since: entry === undefined ? null : entry.since.toISOString(),
        detail: entry === undefined ? null : entry.detail,
      };
    }),
    { kind: 'monitor', name: config.monitorName, address: null, state: 'running', since: startedAt.toISOString(), detail: '' },
  ];
}
