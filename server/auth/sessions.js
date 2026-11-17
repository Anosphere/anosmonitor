import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db/pool.js';

/**
 * The session (docs/schemas.md section 9.3): the cookie and the sessions
 * table.
 *
 * A sign-in makes 32 random bytes. Their base64url form is the cookie's
 * value; their SHA-256 goes into sessions with expires_at = now +
 * SESSION_DAYS. The value itself is not stored, so a copy of the table
 * signs nobody in.
 *
 * The cookie: name monitor_session, HttpOnly (the page's own scripts cannot
 * read it), SameSite=Strict, Path=/, Max-Age of SESSION_DAYS days, and
 * Secure when every origin in WEB_ORIGIN starts with https:.
 *
 * A request is signed in when its cookie's hash is a row whose expires_at
 * is ahead. The days count from the sign-in, and nothing makes them more.
 * Rows that are past it are deleted at the start and once an hour.
 */

/** The cookie's name. */
const COOKIE = 'monitor_session';

/** The cookie's value: 32 bytes as base64url, 43 characters. */
const VALUE = /^[A-Za-z0-9_-]{43}$/;

/** How long a sign-in lasts, in seconds: the cookie's Max-Age, and how far ahead expires_at is set. */
const SESSION_SECONDS = config.sessionDays * 86_400;

/** How often the rows past their expires_at are deleted, in milliseconds. */
const CLEANUP_MS = 3_600_000;

let timer = null;

/** The SHA-256 of a session's 32 bytes, as 32 raw bytes: what the sessions table keeps. */
function hashOf(bytes) {
  return createHash('sha256').update(bytes).digest();
}

/**
 * The value of the monitor_session cookie in the request's Cookie header,
 * or null when there is none or it has not the shape of one. The first
 * cookie of that name counts.
 */
function cookieValueOf(req) {
  const header = req.headers.cookie;
  if (typeof header !== 'string') return null;
  for (const pair of header.split(';')) {
    const at = pair.indexOf('=');
    if (at === -1 || pair.slice(0, at).trim() !== COOKIE) continue;
    const value = pair.slice(at + 1).trim();
    return VALUE.test(value) ? value : null;
  }
  return null;
}

/** The Set-Cookie line: the value with the cookie's attributes. */
function cookieLine(value, maxAge) {
  return `${COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict${config.cookieSecure ? '; Secure' : ''}`;
}

/**
 * The session a request carries: { tokenHash, passkeyId }, the hash of its
 * cookie and the id of the passkey that signed in; null when the request
 * is not signed in. A database error is thrown.
 */
export async function findSession(req) {
  const value = cookieValueOf(req);
  if (value === null) return null;
  const tokenHash = hashOf(Buffer.from(value, 'base64url'));
  const { rows } = await query(
    'SELECT passkey_id FROM sessions WHERE token_hash = $1 AND expires_at > now()',
    [tokenHash],
  );
  return rows.length === 0 ? null : { tokenHash, passkeyId: Number(rows[0].passkey_id) };
}

/**
 * In front of every route that needs the session: 401 `not signed in`
 * without one. With one, `req.session` is { tokenHash, passkeyId }.
 */
export async function requireSession(req, res, next) {
  const session = await findSession(req);
  if (session === null) {
    res.status(401).json({ error: 'not signed in' });
    return;
  }
  req.session = session;
  next();
}

/**
 * A session starts for the passkey `passkeyId`: its row is written on
 * `client`, inside the caller's transaction. Returns the cookie's value,
 * which setCookie puts on the answer once the transaction has landed.
 */
export async function startSession(client, passkeyId) {
  const bytes = randomBytes(32);
  await client.query(
    `INSERT INTO sessions (token_hash, passkey_id, expires_at)
     VALUES ($1, $2, now() + ($3::int * interval '1 second'))`,
    [hashOf(bytes), passkeyId, SESSION_SECONDS],
  );
  return bytes.toString('base64url');
}

/** A session ends: its row is deleted. `session` is what findSession returned. */
export async function endSession(session) {
  await query('DELETE FROM sessions WHERE token_hash = $1', [session.tokenHash]);
}

/** Puts the session cookie on an answer, for SESSION_DAYS days. */
export function setCookie(res, value) {
  res.set('Set-Cookie', cookieLine(value, SESSION_SECONDS));
}

/** Clears the session cookie in the browser: the same cookie, empty, with no time left. */
export function clearCookie(res) {
  res.set('Set-Cookie', cookieLine('', 0));
}

/** Deletes the rows that are past their expires_at. A delete that fails logs one line. Never throws. */
async function deleteExpired() {
  try {
    await query('DELETE FROM sessions WHERE expires_at <= now()');
  } catch (err) {
    console.error(`sessions: the rows past their time were not deleted: ${err.message}`);
  }
}

/** Starts the cleanup: once now, then once an hour. Starting twice does nothing. */
export function startSessionCleanup() {
  if (timer !== null) return;
  timer = setInterval(deleteExpired, CLEANUP_MS);
  timer.unref();
  void deleteExpired();
}

/** Stops the cleanup; a delete already under way finishes by itself. */
export function stopSessionCleanup() {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}
