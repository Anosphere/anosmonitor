import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

/**
 * One shared connection pool for the whole process. PostgreSQL runs on the
 * same machine as this server. On monitor1 the pool connects over the local
 * socket in PGHOST as the user the unit runs as, with no password. On the
 * operator's own machine it connects over TCP to 127.0.0.1:5432 as the
 * logged-in user.
 */
export const pool = new Pool({
  ...config.db,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// An idle client can emit an error (for example when PostgreSQL restarts).
// Without this listener that error is unhandled and crashes the process.
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

/** Runs a single query using a pooled connection. */
export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Runs `fn(client)` inside one database transaction on a client from the
 * pool: BEGIN, fn, COMMIT; ROLLBACK when fn throws, and the client always
 * goes back to the pool. Returns what fn returns. A write of more than one
 * statement goes through here, so it lands whole or not at all.
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Drains the pool. Called once during graceful shutdown. */
export function closePool() {
  return pool.end();
}
