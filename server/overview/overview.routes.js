import { Router } from 'express';
import { requireSession } from '../auth/sessions.js';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { currentRegistry } from '../registry/registry.js';
import { ownServers } from '../servers/servers.js';
import { githubMains, softwareLine } from '../software/github.js';
import { newestSweep } from '../sweep/sweep.js';

/**
 * The overview's routes (docs/schemas.md section 10), both only when
 * signed in, else 401 `not signed in`:
 *
 *   GET /api/overview                 one answer that holds the whole screen
 *   GET /api/validators/:id/history   one validator's last ten states
 *
 * The overview is put together from memory: the registry in use
 * (server/registry/registry.js), the newest sweep (server/sweep/sweep.js)
 * and the newest commits on GitHub main (server/software/github.js). So
 * asking often costs nothing. The history is read from validator_states.
 *
 * Every time in an answer is in UTC, as an ISO text.
 *
 * Mounted at the root in app.js, so the paths below are the full paths.
 */
export const overviewRoutes = Router();

/** States 1 to 4, the red ones: the validator does not work for the network (docs/schemas.md section 6.3). Every other state but good is amber. */
const RED = new Set(['noAnswer', 'validatorDown', 'databaseDown', 'notCounted']);

/** A sweep older than this is stale: three times SWEEP_SECONDS, in milliseconds. */
const STALE_MS = 3 * config.sweepSeconds * 1000;

/** A validator's id as a path carries it: a whole number above 0, short enough for the table's INTEGER. */
const VALIDATOR_ID = /^[1-9][0-9]{0,8}$/;

/** A time as an answer carries it: an ISO text in UTC; null stays null. */
function iso(date) {
  return date === null ? null : date.toISOString();
}

/**
 * One registry row as the overview shows it.
 *
 * An inactive row has its id, "active": false, "state": "notActive", and
 * nothing else.
 *
 * An active row has what the screen shows for it (state, since,
 * keyholderUp) and the newest sweep's fields. `swept` is the row's entry
 * of the newest sweep, or undefined when that sweep did not ask it: before
 * the first sweep, and for a row that turned active since. Then everything
 * but the id and the address is null. `state` and `since` are null too for
 * a row that no judged sweep has seen yet.
 */
function validatorOf(row, swept) {
  if (!row.active) return { id: row.id, active: false, state: 'notActive' };
  return {
    id: row.id,
    active: true,
    address: row.url,
    state: swept?.state ?? null,
    since: iso(swept?.since ?? null),
    keyholderUp: swept?.keyholderUp ?? null,
    answerMs: swept?.answerMs ?? null,
    reason: swept?.reason ?? null,
    doorman: swept?.doorman ?? null,
    worker: swept?.worker ?? null,
    keyholder: swept?.keyholder ?? null,
  };
}

/**
 * The problems: every active validator whose shown state is not good, red
 * before amber, then by id. `validators` is in id order already. A row
 * with no state yet is not a problem.
 */
function problemsOf(validators) {
  const problems = validators
    .filter(({ active, state }) => active && state !== null && state !== 'good')
    .map(({ id, state, since }) => ({ validatorId: id, state, since }));
  return [
    ...problems.filter(({ state }) => RED.has(state)),
    ...problems.filter(({ state }) => !RED.has(state)),
  ];
}

/**
 * When GitHub main was read, as one time for the three repositories: the
 * oldest of their three reads, so the line "not read since" holds for all
 * of them. Null while one of the three has never been read.
 */
function githubReadAt() {
  const reads = Object.values(githubMains()).map(({ readAt }) => readAt);
  if (reads.some((readAt) => readAt === null)) return null;
  return new Date(Math.min(...reads.map((readAt) => readAt.getTime()))).toISOString();
}

/**
 * The whole screen (docs/schemas.md section 10).
 *
 *   sweptAt, tookMs   the newest sweep's start and how long its asking
 *                     took; null before the first sweep
 *   registryRead      false while no registry is there at all; then
 *                     validators is empty
 *   reachedNobody     true when the newest sweep reached no validator
 *   stale             true when sweptAt is more than three times
 *                     SWEEP_SECONDS old
 *   network           the numbers on top; null before the first sweep
 *   problems          [{ validatorId, state, since }]
 *   validators        one entry for each registry row, in id order
 *   servers           our own servers, in the screen's order
 *                     (server/servers/servers.js)
 *   software          for each of the three programs the usual commit, how
 *                     many run it, GitHub main's newest commit and whether
 *                     the two are the same; readAt as githubReadAt has it
 *   registry          GitHub main's registry beside the hash most
 *                     validators report; null while no registry is there
 */
function overview() {
  const registry = currentRegistry();
  const newest = newestSweep();
  const usual = newest === null ? null : newest.usual;
  const usualHash = usual === null ? null : usual.registryHash;

  const swept = new Map();
  if (newest !== null) {
    for (const entry of newest.validators) swept.set(entry.id, entry);
  }
  const validators = registry === null ? [] : registry.rows.map((row) => validatorOf(row, swept.get(row.id)));

  return {
    sweptAt: newest === null ? null : newest.sweptAt.toISOString(),
    tookMs: newest === null ? null : newest.tookMs,
    registryRead: registry !== null,
    reachedNobody: newest !== null && newest.reachedNobody,
    stale: newest !== null && Date.now() - newest.sweptAt.getTime() > STALE_MS,
    network: newest === null ? null : newest.network,
    problems: problemsOf(validators),
    validators,
    servers: ownServers(),
    software: { readAt: githubReadAt(), ...softwareLine(usual) },
    registry: registry === null ? null : {
      hash: registry.hash,
      rows: registry.rows.length,
      active: registry.active,
      fetchedAt: registry.fetchedAt.toISOString(),
      usual: usualHash,
      same: usualHash !== null && usualHash === registry.hash,
    },
  };
}

/** GET /api/overview, signed in. The whole screen in one answer. */
overviewRoutes.get('/api/overview', requireSession, (req, res) => {
  res.json(overview());
});

/**
 * GET /api/validators/:id/history, signed in. The validator's last ten
 * rows of validator_states, newest first:
 * { "history": [{ "state", "detail", "startedAt", "endedAt" }] }.
 * `endedAt` is null for the state it is in now. An id with no rows answers
 * an empty list; an id that is not a whole number above 0 is 404
 * `unknown validator`.
 */
overviewRoutes.get('/api/validators/:id/history', requireSession, async (req, res) => {
  const { id } = req.params;
  if (!VALIDATOR_ID.test(id)) {
    res.status(404).json({ error: 'unknown validator' });
    return;
  }
  const { rows } = await query(
    `SELECT state, detail, started_at, ended_at
       FROM validator_states
      WHERE validator_id = $1
      ORDER BY started_at DESC
      LIMIT 10`,
    [Number(id)],
  );
  res.json({
    history: rows.map((row) => ({
      state: row.state,
      detail: row.detail,
      startedAt: row.started_at.toISOString(),
      endedAt: iso(row.ended_at),
    })),
  });
});
