/**
 * The network's view (docs/schemas.md section 6.2): what most counted
 * validators say. Worked out new in every sweep, from the active rows'
 * answers, as server/sweep/sweep.js reads them.
 *
 *   1. The first voters: every validator that answered and whose worker is
 *      an object, says status ok, says counted true, and has a chain.
 *   2. Ignored by most: an id that is on the ignored list of more than half
 *      of the first voters.
 *   3. The voters: the first voters without the ones ignored by most.
 *   4. The network's tail: the tail most voters report. On a tie, the
 *      higher position.
 *   5. The network's leader: the leader most of the voters at that tail
 *      name.
 *   6. Quiet: true when the network's tail is the same as in the sweep
 *      before.
 *   7. The usual commits: for the validator, the doorman and the keyholder,
 *      the commit most of the answers carry.
 *   8. The usual registry hash: the hash most of the doormen's and workers'
 *      answers carry, counted together.
 *
 * With no voters there is no tail and no leader.
 */

/** A worker has a chain when it reports both halves of its tail. */
function hasChain(worker) {
  return worker.position !== null && worker.recordHash !== null;
}

/**
 * The value most of `values` carry, and how many carry it: { value, count }.
 * On a tie the value that sorts first: the lower number, or the text that
 * comes first. { value: null, count: 0 } for an empty list.
 */
function most(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = { value: null, count: 0 };
  for (const [value, count] of counts) {
    if (count > best.count || (count === best.count && value < best.value)) best = { value, count };
  }
  return best;
}

/** The values that are known: everything but null. */
function known(values) {
  return values.filter((value) => value !== null);
}

/**
 * Rule 4: the tail most voters report, as { position, recordHash }, or null
 * with no voters. On a tie the higher position; two tails still tied stand
 * at the same position, and the record hash that sorts first is taken.
 */
function tailOf(voters) {
  const tails = new Map();
  for (const { worker } of voters) {
    const key = `${worker.position}:${worker.recordHash}`;
    const tail = tails.get(key) ?? { position: worker.position, recordHash: worker.recordHash, count: 0 };
    tail.count += 1;
    tails.set(key, tail);
  }
  let best = null;
  for (const tail of tails.values()) {
    const wins = best === null
      || tail.count > best.count
      || (tail.count === best.count && tail.position > best.position)
      || (tail.count === best.count && tail.position === best.position && tail.recordHash < best.recordHash);
    if (wins) best = tail;
  }
  return best === null ? null : { position: best.position, recordHash: best.recordHash };
}

/**
 * The view of one sweep. `results` is one entry for each active row
 * (server/sweep/sweep.js); `previousTail` is the network's tail of the
 * sweep before, or null when that sweep had none or there was no sweep
 * before. Returns
 *
 *   firstVoters    how many first voters there are
 *   ignoredBy      a Map from an id to how many first voters ignore it
 *   ignoredByMost  a Set of the ids ignored by most
 *   tail           { position, recordHash }, or null with no voters
 *   leader         the id of the network's leader, or null
 *   quiet          true when the tail is the one of the sweep before
 *   usual          { validator, doorman, keyholder, registryHash }: for each
 *                  program { commit, running }, the commit most answers
 *                  carry and how many carry it, null and 0 when no answer
 *                  carries one; registryHash the usual hash, or null
 */
export function networkView(results, previousTail) {
  const firstVoters = results.filter(({ answered, worker }) => (
    answered && worker !== null && worker.status === 'ok' && worker.counted === true && hasChain(worker)
  ));

  const ignoredBy = new Map();
  for (const { worker } of firstVoters) {
    for (const id of new Set(worker.ignored ?? [])) ignoredBy.set(id, (ignoredBy.get(id) ?? 0) + 1);
  }
  const ignoredByMost = new Set();
  for (const [id, count] of ignoredBy) {
    if (count * 2 > firstVoters.length) ignoredByMost.add(id);
  }

  const voters = firstVoters.filter(({ id }) => !ignoredByMost.has(id));
  const tail = tailOf(voters);
  const atTail = tail === null ? [] : voters.filter(({ worker }) => (
    worker.position === tail.position && worker.recordHash === tail.recordHash
  ));
  const leader = most(known(atTail.map(({ worker }) => worker.leader))).value;
  const quiet = tail !== null && previousTail !== null
    && tail.position === previousTail.position && tail.recordHash === previousTail.recordHash;

  const usualCommit = (commits) => {
    const { value, count } = most(known(commits));
    return { commit: value, running: count };
  };

  return {
    firstVoters: firstVoters.length,
    ignoredBy,
    ignoredByMost,
    tail,
    leader,
    quiet,
    usual: {
      validator: usualCommit(results.map(({ worker }) => worker?.commit ?? null)),
      doorman: usualCommit(results.map(({ doorman }) => doorman?.commit ?? null)),
      keyholder: usualCommit(results.map(({ keyholder }) => keyholder?.commit ?? null)),
      registryHash: most(known([
        ...results.map(({ doorman }) => doorman?.registryHash ?? null),
        ...results.map(({ worker }) => worker?.registryHash ?? null),
      ])).value,
    },
  };
}
