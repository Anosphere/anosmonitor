import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { pool, query, withTransaction } from '../db/pool.js';
import { issueChallenge, takeChallenge } from './challenges.js';
import { clearCookie, endSession, findSession, requireSession, setCookie, startSession } from './sessions.js';
import { decodeBase64Url, verifyAuthentication, verifyRegistration } from './webauthn.js';

/**
 * The door's routes (docs/schemas.md section 9.4): the owner's passkey is
 * made, signs in, and is kept in a list. Only the owner's passkeys open
 * the monitor; nobody else signs in.
 *
 * Open to anyone:
 *   GET    /api/session            is there an owner, is this request signed in
 *   POST   /api/passkey/challenge  a challenge for create, signIn or add
 *   POST   /api/passkey/create     the owner's first passkey, while there is none
 *   POST   /api/passkey/sign-in    a sign-in with one of the owner's passkeys
 *
 * Only when signed in, else 401 `not signed in`:
 *   POST   /api/passkey/add        one more passkey
 *   GET    /api/passkeys           the list
 *   DELETE /api/passkeys/:id       removes one; the last one stays
 *   POST   /api/sign-out           ends this session
 *
 * While the server holds no passkey, the first one made is the owner's.
 * From then on nobody makes a passkey from outside: a create challenge is
 * refused, and one more passkey is added only from inside, signed in.
 *
 * A refusal is { "error": "<a short phrase>" } with its status. A stranger
 * gets no answer with data (section 9.5): what these routes tell anyone is
 * whether there is an owner, and a challenge.
 *
 * The log gets one line when a passkey is made, added or removed, at every
 * sign-in, and when a passkey check fails, with the library's reason.
 *
 * Mounted at the root in app.js, so the paths below are the full paths.
 */
export const authRoutes = Router();

const BAD_SHAPE = 'bad request shape';
const BAD_LABEL = 'the label must be 1 to 40 characters';
const BAD_CHALLENGE = 'unknown or expired challenge';
const BAD_PASSKEY = 'passkey verification failed';

/** A passkey's id as a path carries it: a whole number above 0, short enough for the table's BIGINT. */
const PASSKEY_ID = /^[1-9][0-9]{0,17}$/;

/** True for a plain JSON object: not null, not an array. */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A refusal: { error: reason } with `status`. */
function refuse(res, status, reason) {
  res.status(status).json({ error: reason });
}

/** The library's reason for the log: on one line, cut at 200 characters. It can quote what the request carried. */
function oneLine(reason) {
  return String(reason).replace(/[\x00-\x1f\x7f]+/g, ' ').slice(0, 200);
}

/**
 * A label is 1 to 40 characters after trimming. Returns the trimmed label,
 * or null for anything else. A text with a zero character in it is refused
 * too: the database cannot hold one.
 */
function labelOf(value) {
  if (typeof value !== 'string') return null;
  const label = value.trim();
  const length = Array.from(label).length;
  return length >= 1 && length <= 40 && !label.includes('\0') ? label : null;
}

/** A new passkey's credential id is 16 to 1023 bytes, what WebAuthn allows. The masterpod checks a new passkey the same way. */
function credentialIdFits(credentialId) {
  return credentialId.length >= 16 && credentialId.length <= 1023;
}

/** Whether there is an owner, which is whether there is a passkey. `db` is the pool, or the client of a transaction. */
async function ownerExists(db = pool) {
  const { rows } = await db.query('SELECT EXISTS (SELECT 1 FROM passkeys) AS owner');
  return rows[0].owner;
}

/** The owner row's handle, 16 bytes; null when there is no row. */
async function ownerHandle() {
  const { rows } = await query('SELECT handle FROM owner');
  return rows.length === 0 ? null : rows[0].handle;
}

/** The ids of the passkeys there are, base64url: the ones a new passkey's device must not hold already. */
async function credentialIds() {
  const { rows } = await query('SELECT credential_id FROM passkeys ORDER BY id');
  return rows.map((row) => row.credential_id.toString('base64url'));
}

/** The passkey with this credential id: { id, credentialId, publicKey }, or null. */
async function findPasskey(credentialId) {
  const { rows } = await query(
    'SELECT id, credential_id, public_key FROM passkeys WHERE credential_id = $1',
    [credentialId],
  );
  if (rows.length === 0) return null;
  return { id: rows[0].id, credentialId: rows[0].credential_id, publicKey: rows[0].public_key };
}

/**
 * The checks /api/passkey/create and /api/passkey/add share. Both bring
 * { challenge, passkey, label }: the shape, the label, the challenge (one
 * handed out for `purpose`), then the registration itself and the length
 * of its credential id. Returns { label, userHandle, credentialId,
 * publicKey }, the last two as the passkey check returns them; or null
 * when a check failed, and then the refusal is sent already.
 */
async function checkNewPasskey(req, res, purpose) {
  const { body } = req;
  if (!isObject(body) || typeof body.challenge !== 'string' || !isObject(body.passkey)) {
    refuse(res, 400, BAD_SHAPE);
    return null;
  }
  const label = labelOf(body.label);
  if (label === null) {
    refuse(res, 400, BAD_LABEL);
    return null;
  }
  const issued = takeChallenge(body.challenge, purpose);
  if (issued === null) {
    refuse(res, 401, BAD_CHALLENGE);
    return null;
  }
  const registration = await verifyRegistration(body.passkey, issued.challenge);
  if (!registration.ok || !credentialIdFits(registration.credentialId)) {
    console.log(`passkey check failed at ${purpose}: ${oneLine(registration.reason ?? 'credential id length')}`);
    refuse(res, 401, BAD_PASSKEY);
    return null;
  }
  return {
    label,
    userHandle: issued.userHandle,
    credentialId: registration.credentialId,
    publicKey: registration.publicKey,
  };
}

/**
 * GET /api/session, open to anyone:
 * { "owner": <is there a passkey>, "signedIn": <true or false> }. The page
 * reads from it whether to offer the owner's passkey or the sign-in, and
 * whether to show the screen.
 */
authRoutes.get('/api/session', async (req, res) => {
  res.json({ owner: await ownerExists(), signedIn: (await findSession(req)) !== null });
});

/**
 * POST /api/passkey/challenge, open to anyone. Body
 * { "purpose": "create" | "signIn" | "add" }.
 *
 *   create  only while there is no passkey, else 409 `the owner exists
 *           already`
 *   signIn  only when there is one, else 409 `no owner yet`
 *   add     only when signed in, else 401 `not signed in`
 *
 * Answers { "challenge", "rpId" }, and for create and add also
 * "userHandle" (32 hex characters) and "exclude" (the ids of the passkeys
 * there are, base64url). For create the list is empty, and the table is
 * not read for it: a create challenge is handed out only while there is
 * no passkey.
 *
 * The user handle is made when a create challenge is handed out, kept with
 * that challenge, and written to the owner row when the first passkey is.
 * An add challenge carries the handle of the owner row. So every passkey
 * of the owner has the same handle, and a phone lists them as one account.
 */
authRoutes.post('/api/passkey/challenge', async (req, res) => {
  const purpose = isObject(req.body) ? req.body.purpose : undefined;

  if (purpose === 'signIn') {
    if (!(await ownerExists())) return refuse(res, 409, 'no owner yet');
    res.json({ challenge: issueChallenge('signIn'), rpId: config.rpId });
    return;
  }

  let userHandle;
  let exclude = [];
  if (purpose === 'create') {
    if (await ownerExists()) return refuse(res, 409, 'the owner exists already');
    userHandle = randomBytes(16);
  } else if (purpose === 'add') {
    if ((await findSession(req)) === null) return refuse(res, 401, 'not signed in');
    userHandle = await ownerHandle();
    if (userHandle === null) return refuse(res, 409, 'no owner yet');
    exclude = await credentialIds();
  } else {
    return refuse(res, 400, BAD_SHAPE);
  }

  res.json({
    challenge: issueChallenge(purpose, userHandle),
    rpId: config.rpId,
    userHandle: userHandle.toString('hex'),
    exclude,
  });
});

/**
 * POST /api/passkey/create, open to anyone. Body
 * { "challenge", "passkey", "label" }, the challenge one handed out for
 * create. The registration is checked. Then, in one transaction that only
 * one request at a time can be in (it locks the passkeys table): if there
 * is still no passkey, the owner row and the passkey are written, and a
 * session starts. Otherwise 409 `the owner exists already`.
 *
 * The owner row takes the handle kept with the challenge. A row left from
 * before, after the list was emptied on the server, takes the new handle.
 *
 * Answers 201 { "signedIn": true }, with the session cookie.
 */
authRoutes.post('/api/passkey/create', async (req, res) => {
  const passkey = await checkNewPasskey(req, res, 'create');
  if (passkey === null) return;

  const made = await withTransaction(async (client) => {
    await client.query('LOCK TABLE passkeys IN EXCLUSIVE MODE');
    if (await ownerExists(client)) return null;
    await client.query(
      `INSERT INTO owner (only_row, handle) VALUES (true, $1)
       ON CONFLICT (only_row) DO UPDATE SET handle = EXCLUDED.handle, created_at = now()`,
      [passkey.userHandle],
    );
    const { rows } = await client.query(
      'INSERT INTO passkeys (credential_id, public_key, label) VALUES ($1, $2, $3) RETURNING id',
      [passkey.credentialId, passkey.publicKey, passkey.label],
    );
    return { id: rows[0].id, cookie: await startSession(client, rows[0].id) };
  });
  if (made === null) return refuse(res, 409, 'the owner exists already');

  console.log(`passkey ${made.id}: the owner's passkey was made`);
  setCookie(res, made.cookie);
  res.status(201).json({ signedIn: true });
});

/**
 * POST /api/passkey/sign-in, open to anyone. Body
 * { "challenge", "assertion" }, the challenge one handed out for signIn.
 * The passkey is found by the assertion's id, else 401 `unknown passkey`.
 * The assertion is checked against it, last_used_at is set, and a session
 * starts, the two writes in one transaction.
 *
 * Answers { "signedIn": true }, with the session cookie.
 */
authRoutes.post('/api/passkey/sign-in', async (req, res) => {
  const { body } = req;
  if (!isObject(body) || typeof body.challenge !== 'string' || !isObject(body.assertion)) {
    return refuse(res, 400, BAD_SHAPE);
  }
  const issued = takeChallenge(body.challenge, 'signIn');
  if (issued === null) return refuse(res, 401, BAD_CHALLENGE);

  const credentialId = decodeBase64Url(body.assertion.rawId);
  const passkey = credentialId === null ? null : await findPasskey(credentialId);
  if (passkey === null) return refuse(res, 401, 'unknown passkey');

  const verified = await verifyAuthentication(body.assertion, issued.challenge, passkey.credentialId, passkey.publicKey);
  if (!verified.ok) {
    console.log(`passkey check failed at sign-in: ${oneLine(verified.reason)}`);
    return refuse(res, 401, BAD_PASSKEY);
  }

  // The passkey can have been removed since it was found: then no row is
  // updated, and no session starts.
  const cookie = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'UPDATE passkeys SET last_used_at = now() WHERE id = $1 RETURNING id',
      [passkey.id],
    );
    return rows.length === 0 ? null : startSession(client, passkey.id);
  });
  if (cookie === null) return refuse(res, 401, 'unknown passkey');

  console.log(`passkey ${passkey.id}: signed in`);
  setCookie(res, cookie);
  res.json({ signedIn: true });
});

/**
 * POST /api/passkey/add, signed in. Body { "challenge", "passkey",
 * "label" }, the challenge one handed out for add. Writes one more
 * passkey. A passkey that is in the list already is refused with 409.
 *
 * Answers 201 { "id": <the new passkey's id> }.
 */
authRoutes.post('/api/passkey/add', requireSession, async (req, res) => {
  const passkey = await checkNewPasskey(req, res, 'add');
  if (passkey === null) return;

  const { rows } = await query(
    `INSERT INTO passkeys (credential_id, public_key, label) VALUES ($1, $2, $3)
     ON CONFLICT (credential_id) DO NOTHING
     RETURNING id`,
    [passkey.credentialId, passkey.publicKey, passkey.label],
  );
  if (rows.length === 0) return refuse(res, 409, 'this passkey is in the list already');

  console.log(`passkey ${rows[0].id}: added`);
  res.status(201).json({ id: Number(rows[0].id) });
});

/**
 * GET /api/passkeys, signed in. The list, oldest first:
 * { "passkeys": [{ "id", "label", "createdAt", "lastUsedAt",
 * "thisSession" }] }. `lastUsedAt` is null for a passkey that has not
 * signed in; `thisSession` is true for the one this session signed in
 * with.
 */
authRoutes.get('/api/passkeys', requireSession, async (req, res) => {
  const { rows } = await query(
    `SELECT id, label, created_at, last_used_at, id = $1 AS this_session
       FROM passkeys
      ORDER BY id`,
    [req.session.passkeyId],
  );
  res.json({
    passkeys: rows.map((row) => ({
      id: Number(row.id),
      label: row.label,
      createdAt: row.created_at.toISOString(),
      lastUsedAt: row.last_used_at === null ? null : row.last_used_at.toISOString(),
      thisSession: row.this_session,
    })),
  });
});

/**
 * DELETE /api/passkeys/:id, signed in. Removes one passkey, and with it
 * its sessions: the table's own rule deletes them. An id that is not in
 * the list is 404 `unknown passkey`. The last one is refused with 409
 * `the last passkey stays`. The count and the delete run in one
 * transaction that locks the table, so two removals at once cannot empty
 * the list between them.
 *
 * Removing the passkey this session signed in with ends this session too.
 *
 * Answers { "removed": true }.
 */
authRoutes.delete('/api/passkeys/:id', requireSession, async (req, res) => {
  const { id } = req.params;
  if (!PASSKEY_ID.test(id)) return refuse(res, 404, 'unknown passkey');

  // The ids are compared as texts: the database gives a BIGINT as a text of digits.
  const outcome = await withTransaction(async (client) => {
    await client.query('LOCK TABLE passkeys IN EXCLUSIVE MODE');
    const { rows } = await client.query('SELECT id FROM passkeys');
    if (!rows.some((row) => String(row.id) === id)) return 'unknown';
    if (rows.length === 1) return 'last';
    await client.query('DELETE FROM passkeys WHERE id = $1', [id]);
    return 'removed';
  });
  if (outcome === 'unknown') return refuse(res, 404, 'unknown passkey');
  if (outcome === 'last') return refuse(res, 409, 'the last passkey stays');

  console.log(`passkey ${id}: removed`);
  res.json({ removed: true });
});

/**
 * POST /api/sign-out, signed in. Deletes this session's row and clears
 * the cookie. Answers { "signedIn": false }.
 */
authRoutes.post('/api/sign-out', requireSession, async (req, res) => {
  await endSession(req.session);
  clearCookie(res);
  res.json({ signedIn: false });
});
