import { config } from '../config.js';
import { currentRegistry, whenRegistry } from '../registry/registry.js';
import { ask, isObject } from './ask.js';
import { closeState, findOpenStates, recordSweep, writeState } from './history.js';
import { networkView } from './network.js';
import { isCounted, keyholderUp, twoSweeps, workOut } from './states.js';

/**
 * The sweep (docs/schemas.md sections 5 and 6): asking everyone, working
 * out what the answers mean, and keeping the result in memory.
 *
 * The first sweep runs as soon as a registry is there. After that one
 * starts every SWEEP_SECONDS, counted from start to start. If a sweep is
 * still running when the next is due, that one is skipped.
 *
 * One sweep, in order:
 *   1. The open history row of every validator that is no longer an active
 *      registry row is closed. A row with active false is not asked and is
 *      left out of every count.
 *   2. For each active row, two GETs at once (server/sweep/ask.js): the
 *      registry address + /health, and the keyholder door's /health. All
 *      rows at once. The keyholder door is the registry address with the
 *      port 3000 replaced by 3200; a row whose address does not end in
 *      :3000 gets no keyholder check.
 *   3. Each answer is read into the fields the monitor uses. A field that
 *      is missing or of the wrong kind is read as null. The monitor never
 *      stops over an answer's shape.
 *   4. A sweep that reached no validator on port 3000 is not judged: the
 *      monitor's own connection may be down. No state is worked out, and
 *      nothing the screen shows changes.
 *   5. Otherwise the network's view is worked out (server/sweep/network.js),
 *      then each validator's state, and the two-sweep rule decides what the
 *      screen shows (server/sweep/states.js). A change goes into the
 *      history (server/sweep/history.js).
 *   6. The numbers on top are counted, the newest sweep is kept in memory,
 *      and its row goes into the sweeps table.
 *
 * The requests are far under the doormen's limit: two a minute for each
 * doorman, against five a second.
 */

/** A commit as git shortens it: 4 to 40 lowercase hex characters. */
const COMMIT = /^[0-9a-f]{4,40}$/;

/** A SHA-256 as hex, 64 lowercase characters: a registry hash, a record hash. */
const HASH = /^[0-9a-f]{64}$/;

/**
 * What the screen shows for each validator, by id: { state, since, detail,
 * waiting, keyholderUp, keyholderWaiting }. `waiting` and
 * `keyholderWaiting` are the waiting values of the two-sweep rule, or null.
 * `keyholderUp` is true, false, null for a row with no keyholder check, or
 * undefined after a start, until the first judged sweep.
 */
const shown = new Map();

/** The newest sweep, or null before the first (newestSweep below). */
let newest = null;

/** The network's tail in the sweep before, or null when that sweep had none. */
let previousTail = null;

let on = false;
let running = false;
let timer = null;

// ---------------------------------------------------------------------------
// Reading an answer. Each reader returns the value, or null when it is
// missing or of the wrong kind.
// ---------------------------------------------------------------------------

/** The value at `path` inside `value`; undefined when a step on the way is not an object. */
function at(value, ...path) {
  let here = value;
  for (const key of path) {
    if (!isObject(here)) return undefined;
    here = here[key];
  }
  return here;
}

/** A text of at most 64 characters. */
function text(value) {
  return typeof value === 'string' && value.length <= 64 ? value : null;
}

/** A text of the given shape: a commit, a hash. */
function shaped(value, shape) {
  return typeof value === 'string' && shape.test(value) ? value : null;
}

/** A text that reads as a date. */
function date(value) {
  return text(value) !== null && !Number.isNaN(Date.parse(value)) ? value : null;
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A whole number: a position, an id, a count. */
function whole(value) {
  return Number.isSafeInteger(value) ? value : null;
}

/** An uptime: a number that is not negative, rounded to whole seconds. */
function seconds(value) {
  return number(value) === null || value < 0 ? null : Math.round(value);
}

function flag(value) {
  return typeof value === 'boolean' ? value : null;
}

/** The doorman's own fields of its answer on port 3000. */
function readDoorman(body) {
  return {
    commit: shaped(at(body, 'doorman', 'version', 'commit'), COMMIT),
    registryHash: shaped(at(body, 'doorman', 'registry', 'hash'), HASH),
    registryActive: whole(at(body, 'doorman', 'registry', 'active')),
    uptimeSeconds: seconds(body.uptime),
    certificateDaysLeft: number(at(body, 'doorman', 'certificate', 'daysLeft')),
    certificateNotAfter: date(at(body, 'doorman', 'certificate', 'notAfter')),
  };
}

/** The validator's own health answer, the `worker` of the doorman's answer on port 3000; null when it is not an object. */
function readWorker(worker) {
  if (!isObject(worker)) return null;
  return {
    status: text(worker.status),
    commit: shaped(at(worker, 'version', 'commit'), COMMIT),
    registryHash: shaped(at(worker, 'registry', 'hash'), HASH),
    uptimeSeconds: seconds(worker.uptime),
    dbMs: number(at(worker, 'db', 'latencyMs')),
    counted: flag(worker.counted),
    position: whole(at(worker, 'chain', 'position')),
    recordHash: shaped(at(worker, 'chain', 'recordHash'), HASH),
    leader: whole(worker.leader),
    ignored: Array.isArray(worker.ignored) ? worker.ignored.filter(Number.isSafeInteger) : null,
  };
}

/** The keyholder's own health answer, the `worker` of the doorman's answer on port 3200; null when the door gave no answer or it is not an object. */
function readKeyholder(door) {
  if (!door.answered || !isObject(door.body.worker)) return null;
  const { worker } = door.body;
  return {
    answerMs: door.ms,
    status: text(worker.status),
    commit: shaped(at(worker, 'version', 'commit'), COMMIT),
    uptimeSeconds: seconds(worker.uptime),
    dbMs: number(at(worker, 'db', 'latencyMs')),
    copiesWaiting: whole(at(worker, 'copies', 'waiting')),
  };
}

/**
 * One validator's entry of a sweep, from its registry row and its two
 * answers (`keyholderDoor` null for a row with no keyholder check):
 *
 *   id, address      the registry row's id and url
 *   answered         whether port 3000 gave an answer
 *   status           the HTTP status of that answer, else null
 *   answerMs         the milliseconds it took, else null
 *   reason           the short reason when there was no answer, else null
 *   doorman          the doorman's fields, or null with no answer
 *   worker           the validator's fields, or null when there was none
 *   keyholderDoor    { answered, status, reason } for port 3200, or null
 *                    for a row with no keyholder check
 *   keyholder        the keyholder's fields, or null when there was none
 */
function read(row, door, keyholderDoor) {
  return {
    id: row.id,
    address: row.url,
    answered: door.answered,
    status: door.answered ? door.status : null,
    answerMs: door.answered ? door.ms : null,
    reason: door.answered ? null : door.reason,
    doorman: door.answered ? readDoorman(door.body) : null,
    worker: door.answered ? readWorker(door.body.worker) : null,
    keyholderDoor: keyholderDoor === null ? null : {
      answered: keyholderDoor.answered,
      status: keyholderDoor.answered ? keyholderDoor.status : null,
      reason: keyholderDoor.answered ? null : keyholderDoor.reason,
    },
    keyholder: keyholderDoor === null ? null : readKeyholder(keyholderDoor),
  };
}

// ---------------------------------------------------------------------------
// One sweep.
// ---------------------------------------------------------------------------

/** A validator's keyholder door: its registry address with the port 3000 replaced by 3200. Null for an address that does not end in :3000. */
function keyholderDoorOf(url) {
  return url.endsWith(':3000') ? `${url.slice(0, -4)}3200` : null;
}

/** Asks every active row on both ports, all at once. Resolves with one entry for each row, in registry order. */
function askEveryone(active) {
  return Promise.all(active.map(async (row) => {
    const keyholderDoor = keyholderDoorOf(row.url);
    const [door, keyholder] = await Promise.all([
      ask(`${row.url}/health`),
      keyholderDoor === null ? null : ask(`${keyholderDoor}/health`),
    ]);
    return read(row, door, keyholder);
  }));
}

/** Step 1: every validator the screen shows that is not an active registry row any more is dropped, and its open history row closed. */
async function closeNotActive(active, sweptAt) {
  const ids = new Set(active.map((row) => row.id));
  for (const id of [...shown.keys()]) {
    if (ids.has(id)) continue;
    shown.delete(id);
    await closeState(id, sweptAt);
  }
}

/**
 * Step 5 for one validator: its state and whether its keyholder is up, as
 * this sweep works them out, put through the two-sweep rule.
 *
 * A validator the screen shows nothing for yet (the monitor's first sweep
 * ever, or a new registry row) takes the state of its first sweep at once.
 * The keyholder value has no history rows, so after a start it too is
 * taken at once.
 */
async function judge(result, view, sweptAt) {
  const worked = workOut(result, view);
  const up = keyholderUp(result);

  const entry = shown.get(result.id);
  if (entry === undefined) {
    shown.set(result.id, {
      state: worked.state,
      since: sweptAt,
      detail: worked.detail,
      waiting: null,
      keyholderUp: up,
      keyholderWaiting: null,
    });
    await writeState({ validatorId: result.id, from: null, state: worked.state, detail: worked.detail, since: sweptAt });
    return;
  }

  const state = twoSweeps(entry.state, entry.waiting, { value: worked.state, detail: worked.detail }, sweptAt);
  if (state.changed) {
    const from = entry.state;
    entry.state = state.value;
    entry.since = state.since;
    entry.detail = state.detail;
    entry.waiting = null;
    await writeState({ validatorId: result.id, from, state: entry.state, detail: entry.detail, since: entry.since });
  } else {
    entry.waiting = state.waiting;
  }

  if (entry.keyholderUp === undefined) {
    entry.keyholderUp = up;
    return;
  }
  const keyholder = twoSweeps(entry.keyholderUp, entry.keyholderWaiting, { value: up, detail: '' }, sweptAt);
  if (keyholder.changed) {
    entry.keyholderUp = keyholder.value;
    entry.keyholderWaiting = null;
  } else {
    entry.keyholderWaiting = keyholder.waiting;
  }
}

/**
 * Step 6, the numbers on top (docs/schemas.md section 6.5), from what the
 * screen shows after this sweep. `view` is null for a sweep that was not
 * judged; then there is no position and no leader.
 *
 *   counted       the active validators whose shown state is none of the
 *                 states 1 to 5
 *   floor         the smallest whole number that, times 100, is at least
 *                 IGNORE_FLOOR_PERCENT times the active rows
 *   keyholdersUp  the active validators whose keyholder is shown as up
 *   position, recordHash, leader   the network's, from this sweep
 */
function numbersOnTop(active, view) {
  let counted = 0;
  let keyholdersUp = 0;
  for (const { id } of active) {
    const entry = shown.get(id);
    if (entry === undefined) continue;
    if (isCounted(entry.state)) counted += 1;
    if (entry.keyholderUp === true) keyholdersUp += 1;
  }
  const tail = view === null ? null : view.tail;
  return {
    active: active.length,
    counted,
    floor: Math.ceil((config.ignoreFloorPercent * active.length) / 100),
    keyholdersUp,
    position: tail === null ? null : tail.position,
    recordHash: tail === null ? null : tail.recordHash,
    leader: view === null ? null : view.leader,
  };
}

/** One validator's entry of the newest sweep: what the screen shows for it, and this sweep's fields. */
function entryOf(result) {
  const entry = shown.get(result.id);
  return {
    id: result.id,
    address: result.address,
    state: entry === undefined ? null : entry.state,
    since: entry === undefined ? null : entry.since,
    keyholderUp: entry === undefined || entry.keyholderUp === undefined ? null : entry.keyholderUp,
    answerMs: result.answerMs,
    reason: result.reason,
    doorman: result.doorman,
    worker: result.worker,
    keyholder: result.keyholder,
  };
}

/** One sweep, as described at the top. Does nothing while there is no registry. */
async function sweepOnce() {
  const registry = currentRegistry();
  if (registry === null) return;

  const sweptAt = new Date();
  const active = registry.rows.filter((row) => row.active);
  await closeNotActive(active, sweptAt);

  const started = performance.now();
  const results = await askEveryone(active);
  const tookMs = Math.round(performance.now() - started);
  const reached = results.filter((result) => result.answered).length;
  const reachedNobody = reached === 0;

  let view = null;
  if (reachedNobody) {
    previousTail = null;
  } else {
    view = networkView(results, previousTail);
    previousTail = view.tail;
    for (const result of results) await judge(result, view, sweptAt);
  }

  const network = numbersOnTop(active, view);
  newest = {
    sweptAt,
    tookMs,
    reached,
    reachedNobody,
    network,
    quiet: view === null ? false : view.quiet,
    usual: view === null ? null : view.usual,
    validators: results.map(entryOf),
  };

  await recordSweep({
    sweptAt,
    tookMs,
    active: network.active,
    reached,
    counted: reachedNobody ? null : network.counted,
    keyholdersUp: reachedNobody ? null : network.keyholdersUp,
    position: network.position,
    leader: network.leader,
  });
}

// ---------------------------------------------------------------------------
// The clock.
// ---------------------------------------------------------------------------

/** One turn of the clock: a sweep, unless the one before is still running. Never throws. */
async function tick() {
  if (running) {
    console.log('sweep skipped: the sweep before is still running');
    return;
  }
  running = true;
  try {
    await sweepOnce();
  } catch (err) {
    console.error(`sweep failed: ${err.stack ?? err}`);
  } finally {
    running = false;
  }
}

/**
 * Starts the sweeps. First the states the screen shows are taken from the
 * open rows of validator_states: if the monitor was down for a while, the
 * history reads as if the old state had lasted until it came back, and the
 * gap shows in the sweeps table. Then, as soon as a registry is there, the
 * first sweep runs, and one starts every SWEEP_SECONDS after it. Resolves
 * once the open rows are read; a database error is thrown, and stops the
 * start. Starting twice does nothing.
 */
export async function startSweeps() {
  if (on) return;
  on = true;
  for (const { validatorId, state, detail, since } of await findOpenStates()) {
    shown.set(validatorId, { state, since, detail, waiting: null, keyholderUp: undefined, keyholderWaiting: null });
  }
  whenRegistry().then(() => {
    if (!on || timer !== null) return;
    timer = setInterval(tick, config.sweepSeconds * 1000);
    timer.unref();
    void tick();
  });
}

/** Stops the clock; a sweep already running finishes by itself. */
export function stopSweeps() {
  on = false;
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

/**
 * The newest sweep, or null before the first:
 *
 *   sweptAt        when it started, a Date
 *   tookMs         how long the asking took
 *   reached        how many validators answered on port 3000
 *   reachedNobody  true when none did; such a sweep is not judged
 *   network        the numbers on top: { active, counted, floor,
 *                  keyholdersUp, position, recordHash, leader }
 *   quiet          whether the network's tail is the one of the sweep before
 *   usual          the usual commits and the usual registry hash
 *                  (server/sweep/network.js), or null when not judged
 *   validators     one entry for each active row, in id order: { id,
 *                  address, state, since, keyholderUp, answerMs, reason,
 *                  doorman, worker, keyholder }. `state`, `since` and
 *                  `keyholderUp` are what the screen shows; the rest is
 *                  this sweep's.
 */
export function newestSweep() {
  return newest;
}
