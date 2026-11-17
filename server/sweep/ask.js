import { config } from '../config.js';

/**
 * One GET to a doorman (docs/schemas.md section 5), with the time limit and
 * the size limit.
 *
 * Node's fetch, the header User-Agent: anosmonitor, no redirect followed,
 * ANSWER_TIMEOUT_SECONDS for the whole answer, the certificate checked the
 * normal way. The body is read up to 64 KB and parsed as JSON.
 *
 * The result is either an answer or no answer. Any HTTP status with a JSON
 * object is an answer: a doorman says 503 with its whole health object when
 * something behind it is down. A body longer than 64 KB, or one that is not
 * a JSON object, counts as no answer.
 */

/** How long one answer may take, in milliseconds. */
const TIMEOUT_MS = config.answerTimeoutSeconds * 1000;

/** True for a plain JSON object: not null, not an array. */
export function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The body as text, or null when it is longer than `limit` bytes. The
 * reading stops at the limit, so a body without an end costs 64 KB at most.
 */
async function readUpTo(response, limit) {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Why a GET got no answer, in a few words: `timeout`, `connection refused`,
 * `certificate: <what is wrong with it>`, or the error's code, such as
 * ECONNRESET or EHOSTUNREACH. fetch puts the real error under `cause`.
 */
function reasonOf(err) {
  if (typeof err !== 'object' || err === null) return String(err).slice(0, 80);
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'timeout';
  const cause = err.cause ?? err;
  const code = typeof cause.code === 'string' ? cause.code : '';
  if (code === 'ECONNREFUSED') return 'connection refused';
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'timeout';
  if (/CERT|SELF_SIGNED|ISSUER|SIGNATURE|ALTNAME/.test(code)) return `certificate: ${cause.message}`.slice(0, 80);
  return String(code || cause.message || err.message || 'no answer').slice(0, 80);
}

/**
 * GETs `url`. Resolves, and never rejects, with one of
 *   { answered: true, status, ms, body }  the HTTP status, the milliseconds
 *                                         it took, the parsed JSON object
 *   { answered: false, reason }           no answer, with a short reason:
 *                                         the timeout, the refused
 *                                         connection, the certificate's
 *                                         fault, `too long`, `not JSON`
 */
export async function ask(url) {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': config.userAgent },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await readUpTo(response, config.answerMaxBytes);
    if (text === null) return { answered: false, reason: 'too long' };
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { answered: false, reason: 'not JSON' };
    }
    if (!isObject(body)) return { answered: false, reason: 'not JSON' };
    return { answered: true, status: response.status, ms: Math.round(performance.now() - started), body };
  } catch (err) {
    return { answered: false, reason: reasonOf(err) };
  }
}
