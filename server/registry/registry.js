import canonicalize from 'canonicalize';
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db/pool.js';

/**
 * The registry (docs/schemas.md section 4): the list of validators the
 * monitor sweeps. It is the file the validators themselves pull,
 * network/testnet.registry.json of the validator's repository, read from
 * GitHub main at REGISTRY_URL. This repository holds no copy of it and no
 * validator address.
 *
 * At the start the monitor takes the row of the registry_copy table, if
 * there is one, so it can sweep at once. Then, and every GITHUB_MINUTES
 * after that, it reads the file from GitHub, with 15 seconds for the read.
 *
 * The file must have the validators' shape, the checks of anossoftware's
 * src/validators/registry.service.js, copied with the same messages: a
 * JSON object; validators a non-empty array; each row's id a positive
 * integer that appears once; publicKey 66 lowercase hex characters, with
 * "<fill in>" refused by name; url starting http:// or https:// with no
 * trailing slash; active true or false; firstLeader null or the id of a
 * row in the file. The validator's check of its own row is left out: the
 * monitor has no row.
 *
 * A file that passes is kept in memory and written to registry_copy, with
 * its hash. The hash is the validators' own rule: the SHA-256 of the
 * canonical JSON (the canonicalize package) of the rows ordered by id,
 * each { id, publicKey, url, active }. So the hash worked out here from
 * GitHub's file can be compared with the hash the validators report.
 *
 * A read that fails, or a file that does not pass, changes nothing: the
 * monitor goes on with the registry it has, and logs one line. With no
 * registry at all there is no sweep.
 */

/** The placeholder a row ships with before its validator's key exists. */
const FILL_IN = '<fill in>';

/** The registry in use, or null while there is none: { firstLeader, rows, active, hash, fetchedAt }. */
let current = null;

let timer = null;

/** Resolves once a registry is there, from the kept copy or from GitHub. */
let announce;
const ready = new Promise((resolve) => {
  announce = resolve;
});

/** True for a plain JSON object: not null, not an array. */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function fail(message) {
  throw new Error(message);
}

/** One row of the file, checked; `ids` collects the ids seen so far. */
function checkRow(row, index, ids) {
  const where = `row ${index + 1}`;
  if (!isObject(row)) fail(`${where} must be an object`);
  if (!isPositiveInteger(row.id)) fail(`${where}: id must be a positive integer`);
  if (ids.has(row.id)) fail(`${where}: id ${row.id} appears twice`);
  ids.add(row.id);

  const at = `${where} (id ${row.id})`;
  if (row.publicKey === FILL_IN) fail(`${at}: publicKey is still "${FILL_IN}"`);
  if (typeof row.publicKey !== 'string' || !/^[0-9a-f]{66}$/.test(row.publicKey)) {
    fail(`${at}: publicKey must be 66 lowercase hex characters`);
  }
  if (typeof row.url !== 'string' || !/^https?:\/\//.test(row.url) || row.url.endsWith('/')) {
    fail(`${at}: url must start with http:// or https:// and have no trailing slash`);
  }
  if (typeof row.active !== 'boolean') fail(`${at}: active must be true or false`);
  return { id: row.id, publicKey: row.publicKey, url: row.url, active: row.active };
}

/**
 * Checks the parsed file. Returns { firstLeader, rows }, the rows ordered
 * by id and each cut down to { id, publicKey, url, active }. Throws, with a
 * message naming the row and the field, when the file does not pass.
 */
function checkRegistry(parsed) {
  if (!isObject(parsed)) fail('must be a JSON object');

  const { firstLeader, validators } = parsed;
  if (!Array.isArray(validators) || validators.length === 0) fail('validators must be a non-empty array');
  const ids = new Set();
  const rows = validators.map((row, index) => checkRow(row, index, ids));
  if (firstLeader !== null && !(isPositiveInteger(firstLeader) && ids.has(firstLeader))) {
    fail('firstLeader must be null or the id of a row in the file');
  }
  return { firstLeader, rows: rows.sort((a, b) => a.id - b.id) };
}

/** The validators' registry hash over rows ordered by id, as 64 lowercase hex characters. */
function registryHash(rows) {
  return createHash('sha256').update(canonicalize(rows), 'utf8').digest('hex');
}

/**
 * Makes a checked registry the one in use. Logs one line when it is the
 * first, or when its hash is not the one in use; `from` says where it came
 * from. Returns the registry in use.
 */
function keep({ firstLeader, rows }, fetchedAt, from) {
  const hash = registryHash(rows);
  const active = rows.filter((row) => row.active).length;
  if (current === null || current.hash !== hash) {
    console.log(`registry ${hash.slice(0, 16)}, ${active} active, ${from}`);
  }
  current = Object.freeze({ firstLeader, rows: Object.freeze(rows.map(Object.freeze)), active, hash, fetchedAt });
  announce();
  return current;
}

/** Why a read from GitHub failed: fetch's message, with its cause when it has one. */
function reasonOf(err) {
  return err.cause?.message ? `${err.message}: ${err.cause.message}` : err.message;
}

/** The start: the row of registry_copy, if there is one. A database error is thrown, and stops the start. */
async function takeCopy() {
  const { rows } = await query('SELECT body, fetched_at FROM registry_copy');
  if (rows.length === 0) return;
  const [{ body, fetched_at: fetchedAt }] = rows;
  try {
    keep(checkRegistry(body), fetchedAt, `the copy read from GitHub on ${fetchedAt.toISOString()}`);
  } catch (err) {
    console.error(`registry: the kept copy does not pass: ${err.message}`);
  }
}

/** The file on GitHub main, parsed. Throws when it cannot be read or is not JSON. */
async function fetchFile() {
  const response = await fetch(config.registryUrl, {
    headers: { 'User-Agent': config.userAgent },
    signal: AbortSignal.timeout(config.githubTimeoutMs),
  });
  if (response.status !== 200) fail(`GitHub answered ${response.status}`);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return fail('the file is not JSON');
  }
}

/**
 * One read from GitHub. A file that passes becomes the registry in use and
 * is written to registry_copy. A read that fails, or a file that does not
 * pass, changes nothing and logs one line. Never throws.
 */
export async function readRegistry() {
  let kept;
  try {
    kept = keep(checkRegistry(await fetchFile()), new Date(), 'read from GitHub');
  } catch (err) {
    const having = current === null ? 'there is no registry yet' : `going on with registry ${current.hash.slice(0, 16)}`;
    console.error(`registry not taken from ${config.registryUrl}: ${reasonOf(err)}; ${having}`);
    return;
  }
  try {
    await query(
      `INSERT INTO registry_copy (only_row, body, hash, fetched_at)
       VALUES (true, $1::jsonb, $2, $3)
       ON CONFLICT (only_row) DO UPDATE
         SET body = EXCLUDED.body, hash = EXCLUDED.hash, fetched_at = EXCLUDED.fetched_at`,
      [JSON.stringify({ firstLeader: kept.firstLeader, validators: kept.rows }), kept.hash, kept.fetchedAt],
    );
  } catch (err) {
    console.error(`registry: the copy was not written: ${err.message}`);
  }
}

/**
 * Starts the registry: the kept copy first, then one read from GitHub now
 * and one every GITHUB_MINUTES. Resolves once the kept copy is taken; the
 * read from GitHub goes on by itself. Starting it twice does nothing.
 */
export async function startRegistry() {
  if (timer !== null) return;
  await takeCopy();
  timer = setInterval(readRegistry, config.githubMinutes * 60_000);
  timer.unref();
  void readRegistry();
}

/** Stops the reads; one already under way finishes by itself. */
export function stopRegistry() {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

/**
 * The registry in use, or null while there is none: { firstLeader, rows,
 * active, hash, fetchedAt }. `rows` is every row of the file ordered by id,
 * each { id, publicKey, url, active }; `active` the count of active rows;
 * `hash` the validators' hash as 64 hex characters; `fetchedAt` when this
 * registry was last read from GitHub.
 */
export function currentRegistry() {
  return current;
}

/** A promise that resolves once a registry is there. The first sweep waits for it. */
export function whenRegistry() {
  return ready;
}
