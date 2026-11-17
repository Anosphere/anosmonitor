import { randomBytes } from 'node:crypto';

/**
 * The passkey challenges (docs/schemas.md section 9.2), in memory.
 *
 * A challenge is 32 random bytes, handed out as 64 hex characters. The
 * server keeps it with its purpose for five minutes, and forgets it when
 * it is used. It keeps 200 at most; the oldest goes first.
 *
 * One process runs the monitor, so memory is enough. A restart in the
 * middle of a sign-in means the operator presses the button again.
 */

/** How long a challenge is kept, in milliseconds. */
const KEPT_MS = 5 * 60_000;

/** How many challenges are kept at most. */
const KEPT_AT_MOST = 200;

/**
 * The challenges handed out and not used yet, by their 64 hex characters:
 * { purpose, userHandle, expiresAt }. A Map keeps the order its entries
 * were added in, and every challenge is kept equally long, so the first
 * entry is the oldest, and the ones past their time stand at the front.
 */
const challenges = new Map();

/** Forgets the challenges past their time, and then the oldest until there is room for one more. */
function makeRoom(now) {
  for (const [hex, { expiresAt }] of challenges) {
    if (expiresAt > now && challenges.size < KEPT_AT_MOST) break;
    challenges.delete(hex);
  }
}

/**
 * Hands out a challenge for `purpose` (create, signIn or add) and keeps it.
 * `userHandle` is the 16 bytes that go with a create or an add challenge,
 * null for signIn. Returns the challenge as 64 hex characters.
 */
export function issueChallenge(purpose, userHandle = null) {
  const now = Date.now();
  makeRoom(now);
  const hex = randomBytes(32).toString('hex');
  challenges.set(hex, { purpose, userHandle, expiresAt: now + KEPT_MS });
  return hex;
}

/**
 * Uses a challenge: it is forgotten here, whatever comes of the request
 * that brought it. Returns { challenge, userHandle }, the challenge as its
 * 32 raw bytes, when `hex` is one handed out for `purpose` no longer than
 * five minutes ago; null for anything else.
 */
export function takeChallenge(hex, purpose) {
  const kept = challenges.get(hex);
  if (kept === undefined) return null;
  challenges.delete(hex);
  if (kept.purpose !== purpose || kept.expiresAt <= Date.now()) return null;
  return { challenge: Buffer.from(hex, 'hex'), userHandle: kept.userHandle };
}
