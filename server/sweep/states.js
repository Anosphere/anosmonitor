import { config } from '../config.js';

/**
 * One validator's state, and the two-sweep rule (docs/schemas.md sections
 * 6.3 and 6.4).
 *
 * Each validator has one state at a time, the first of eleven that fits, in
 * this order:
 *
 *    1. noAnswer       it did not answer on port 3000
 *    2. validatorDown  it answered, and its worker is null
 *    3. databaseDown   its worker's status is not ok
 *    4. notCounted     its worker's counted is not true
 *    5. votedOut       its id is ignored by most
 *    6. outOfStep      its chain is not where the network's is (outOfStep
 *                      below)
 *    7. certificate    doorman.certificate is null, or has fewer than
 *                      CERTIFICATE_WARN_DAYS days left
 *    8. otherSoftware  its validator, doorman or keyholder commit is known
 *                      and is not the usual one
 *    9. otherRegistry  its doorman's or its worker's registry hash is not
 *                      the usual one
 *   10. keyholderDown  port 3200 gave no answer, or the keyholder behind it
 *                      is null, or its status is not ok
 *   11. good           none of the above
 *
 * States 1 to 4 are red: the validator does not work for the network.
 * States 5 to 10 are amber: it works and needs a look. State 11 is green.
 *
 * With each state goes a detail: one short line that says what was seen,
 * kept in the history (server/sweep/history.js). It is empty for good.
 */

/** States 1 to 5: a validator in one of them is not among the validators counted. */
const NOT_COUNTED = new Set(['noAnswer', 'validatorDown', 'databaseDown', 'notCounted', 'votedOut']);

/** Whether a validator in `state` is one of the validators counted (docs/schemas.md section 6.5). */
export function isCounted(state) {
  return !NOT_COUNTED.has(state);
}

/** "position 288, the network 415": where a worker's chain stands, and where the network's does. */
function positions(worker, view) {
  const own = worker.position === null ? 'no chain' : `position ${worker.position}`;
  return view.tail === null ? own : `${own}, the network ${view.tail.position}`;
}

/**
 * State 6. The detail line when the worker is out of step, else null. The
 * validator has a chain, and one of these holds:
 *   - its position is two or more away from the network's, in either
 *     direction;
 *   - it stands at the network's position with another record hash;
 *   - the network is quiet, and its tail is not the network's;
 *   - the network is quiet, it stands at the network's tail, and it names
 *     another leader.
 * While a record is being written, a sweep can catch some validators one
 * position ahead of the others for a moment. That is why a difference of
 * one, and another leader, count only while the network is quiet.
 */
function outOfStep(worker, view) {
  const { tail } = view;
  if (tail === null || worker.position === null || worker.recordHash === null) return null;
  const atTail = worker.position === tail.position && worker.recordHash === tail.recordHash;
  if (Math.abs(worker.position - tail.position) >= 2) return positions(worker, view);
  if (worker.position === tail.position && !atTail) return `another record at position ${tail.position}`;
  if (!view.quiet) return null;
  if (!atTail) return positions(worker, view);
  if (worker.leader !== view.leader) {
    return `names leader ${worker.leader ?? 'nobody'}, the network ${view.leader ?? 'nobody'}`;
  }
  return null;
}

/** State 8. "validator 1a2b3c4, most run 6b27427" for each program whose commit is known and is not the usual one, else null. */
function otherSoftware(result, usual) {
  const found = [];
  const compare = (program, commit) => {
    const most = usual[program].commit;
    if (commit !== null && most !== null && commit !== most) found.push(`${program} ${commit}, most run ${most}`);
  };
  compare('validator', result.worker.commit);
  compare('doorman', result.doorman.commit);
  compare('keyholder', result.keyholder === null ? null : result.keyholder.commit);
  return found.length === 0 ? null : found.join('; ');
}

/** State 9. "doorman 9f8e7d6c, most have 1076ef27" when the doorman's or the worker's registry hash is not the usual one, else null. A hash that is not known is not compared. */
function otherRegistry(result, usual) {
  if (usual === null) return null;
  const found = [];
  const compare = (who, hash) => {
    if (hash !== null && hash !== usual) found.push(`${who} ${hash.slice(0, 8)}`);
  };
  compare('doorman', result.doorman.registryHash);
  compare('validator', result.worker.registryHash);
  return found.length === 0 ? null : `${found.join(', ')}, most have ${usual.slice(0, 8)}`;
}

/**
 * State 10. The detail line when the keyholder is down, else null: port
 * 3200 gave no answer, or the keyholder behind it is null, or its status
 * is not ok. Null too for a row with no keyholder check, one whose address
 * does not end in :3000.
 */
function keyholderDown(result) {
  const door = result.keyholderDoor;
  if (door === null) return null;
  if (!door.answered) return door.reason;
  if (result.keyholder === null) return `the doorman answered ${door.status}, no keyholder behind it`;
  if (result.keyholder.status !== 'ok') return `status ${result.keyholder.status ?? 'not given'}`;
  return null;
}

/** Whether a validator's keyholder is up in this sweep: true or false, or null for a row with no keyholder check. */
export function keyholderUp(result) {
  return result.keyholderDoor === null ? null : keyholderDown(result) === null;
}

/**
 * The state one sweep works out for one validator: { state, detail }, the
 * first of the eleven that fits. `result` is the validator's entry of the
 * sweep (server/sweep/sweep.js), `view` the network's view of the same
 * sweep (server/sweep/network.js).
 */
export function workOut(result, view) {
  if (!result.answered) return { state: 'noAnswer', detail: result.reason };

  const { doorman, worker } = result;
  if (worker === null) {
    return { state: 'validatorDown', detail: `the doorman answered ${result.status}, no validator behind it` };
  }
  if (worker.status !== 'ok') return { state: 'databaseDown', detail: `status ${worker.status ?? 'not given'}` };
  if (worker.counted !== true) return { state: 'notCounted', detail: positions(worker, view) };

  if (view.ignoredByMost.has(result.id)) {
    return { state: 'votedOut', detail: `ignored by ${view.ignoredBy.get(result.id)} of ${view.firstVoters}` };
  }

  const step = outOfStep(worker, view);
  if (step !== null) return { state: 'outOfStep', detail: step };

  if (doorman.certificateDaysLeft === null) return { state: 'certificate', detail: 'no certificate' };
  if (doorman.certificateDaysLeft < config.certificateWarnDays) {
    return { state: 'certificate', detail: `${doorman.certificateDaysLeft} days left` };
  }

  const software = otherSoftware(result, view.usual);
  if (software !== null) return { state: 'otherSoftware', detail: software };

  const registry = otherRegistry(result, view.usual.registryHash);
  if (registry !== null) return { state: 'otherRegistry', detail: registry };

  const keyholder = keyholderDown(result);
  if (keyholder !== null) return { state: 'keyholderDown', detail: keyholder };

  return { state: 'good', detail: '' };
}

/**
 * The two-sweep rule, for one value: a validator's state, or whether its
 * keyholder is up. `shown` is the value the screen shows; `waiting` is the
 * waiting value, { value, at, detail }, or null; `worked` is what this
 * sweep worked out, { value, detail }; `at` is this sweep's time.
 *
 *   - The sweep works out the value the screen shows: the waiting value is
 *     dropped.
 *   - It works out another value, and that is the waiting value: the screen
 *     now shows it. It began at the time of the first of the two sweeps.
 *   - It works out another value, and that is not the waiting value: it
 *     becomes the waiting value, with this sweep's time.
 *
 * Returns { changed: false, waiting } with the waiting value to keep, or
 * { changed: true, value, since, detail } with the value the screen now
 * shows, when it began, and the detail of the sweep that first saw it.
 */
export function twoSweeps(shown, waiting, worked, at) {
  if (worked.value === shown) return { changed: false, waiting: null };
  if (waiting !== null && waiting.value === worked.value) {
    return { changed: true, value: waiting.value, since: waiting.at, detail: waiting.detail };
  }
  return { changed: false, waiting: { value: worked.value, at, detail: worked.detail } };
}
