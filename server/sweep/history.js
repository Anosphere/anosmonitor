import { query, withTransaction } from '../db/pool.js';

/**
 * The history (docs/schemas.md section 6.6): the two tables
 * validator_states and sweeps, and the log lines that go with them.
 *
 *   - When a shown state changes, the validator's open row gets its
 *     ended_at, and a new row is written with the new state, its start and
 *     a detail line. One log line is printed too:
 *     `validator 24: good -> notCounted`.
 *   - When a registry row turns inactive, its open row is closed.
 *   - After every sweep, one row in sweeps.
 *   - The log gets one summary line for the first sweep after a start, and
 *     then one for the first sweep of every hour.
 *
 * The answers themselves are not stored. A write that fails is logged and
 * not thrown: the screen shows what is in memory, and the next sweep goes
 * on.
 */

/** The hour of the last summary line, counted in hours since 1970; null before the first. */
let summaryHour = null;

/**
 * The open rows: the state each validator is in now, as
 * { validatorId, state, detail, since }. At a start these are the states
 * the screen shows. A database error is thrown, and stops the start.
 */
export async function findOpenStates() {
  const { rows } = await query(
    'SELECT validator_id, state, detail, started_at FROM validator_states WHERE ended_at IS NULL',
  );
  return rows.map((row) => ({
    validatorId: row.validator_id,
    state: row.state,
    detail: row.detail,
    since: row.started_at,
  }));
}

/**
 * A validator's new shown state. Its open row, if it has one, ends at
 * `since`, and a new row begins there, both in one transaction. `from` is
 * the state shown before, or null for a validator's first state, which
 * prints no log line.
 */
export async function writeState({ validatorId, from, state, detail, since }) {
  if (from !== null) console.log(`validator ${validatorId}: ${from} -> ${state}`);
  try {
    await withTransaction(async (client) => {
      await client.query(
        'UPDATE validator_states SET ended_at = $2 WHERE validator_id = $1 AND ended_at IS NULL',
        [validatorId, since],
      );
      await client.query(
        'INSERT INTO validator_states (validator_id, state, detail, started_at) VALUES ($1, $2, $3, $4)',
        [validatorId, state, detail, since],
      );
    });
  } catch (err) {
    console.error(`history: validator ${validatorId}, state ${state}, was not written: ${err.message}`);
  }
}

/** A registry row turned inactive, or left the registry: its open row is closed at `at`. */
export async function closeState(validatorId, at) {
  console.log(`validator ${validatorId}: not an active registry row any more`);
  try {
    await query(
      'UPDATE validator_states SET ended_at = $2 WHERE validator_id = $1 AND ended_at IS NULL',
      [validatorId, at],
    );
  } catch (err) {
    console.error(`history: validator ${validatorId}'s open row was not closed: ${err.message}`);
  }
}

/** `sweep 18:25:40Z: 25 of 25 counted, 25 keyholders up, position 639, leader 22, 912 ms`. */
function summary({ sweptAt, tookMs, active, reached, counted, keyholdersUp, position, leader }) {
  const time = `${sweptAt.toISOString().slice(11, 19)}Z`;
  if (reached === 0) return `sweep ${time}: reached no validator, the monitor's own connection may be down, ${tookMs} ms`;
  return `sweep ${time}: ${counted} of ${active} counted, ${keyholdersUp} keyholders up, `
    + `position ${position ?? '-'}, leader ${leader ?? '-'}, ${tookMs} ms`;
}

/**
 * One sweep's numbers: { sweptAt, tookMs, active, reached, counted,
 * keyholdersUp, position, leader }, the last four null for a sweep that
 * reached nobody. Writes the row in sweeps, and prints the summary line
 * when one is due.
 */
export async function recordSweep(sweep) {
  const hour = Math.floor(sweep.sweptAt.getTime() / 3_600_000);
  if (hour !== summaryHour) {
    summaryHour = hour;
    console.log(summary(sweep));
  }
  try {
    await query(
      `INSERT INTO sweeps (swept_at, took_ms, active, reached, counted, keyholders_up, position, leader)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (swept_at) DO NOTHING`,
      [sweep.sweptAt, sweep.tookMs, sweep.active, sweep.reached,
        sweep.counted, sweep.keyholdersUp, sweep.position, sweep.leader],
    );
  } catch (err) {
    console.error(`history: the sweep of ${sweep.sweptAt.toISOString()} was not written: ${err.message}`);
  }
}
