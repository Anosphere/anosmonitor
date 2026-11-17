import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { query } from './pool.js';

/**
 * Applying db/schema.sql (docs/schemas.md section 3). The server does it
 * itself at every start, before anything else uses the database, so a pull
 * that changed the file needs no schema step by hand. Every statement in
 * the file is safe to repeat.
 */

/** Where the file is: db/schema.sql at the repo root, whatever the working directory. */
const SCHEMA_PATH = fileURLToPath(new URL('../../db/schema.sql', import.meta.url));

/**
 * Runs the whole file as one query. With no parameters the database takes
 * several statements at once and runs them as one transaction, so the file
 * lands whole or not at all. Throws when the file cannot be read or the
 * database refuses it; the start stops then.
 */
export async function applySchema() {
  const sql = await readFile(SCHEMA_PATH, 'utf8');
  await query(sql);
}
