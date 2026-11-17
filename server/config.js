/**
 * The monitor's settings (docs/schemas.md section 2), every one with a local
 * default, so the operator's own machine needs no env file. Read once at
 * the start. On monitor1 they come from the committed file
 * network/monitor.env, which the unit hands to node with --env-file.
 *
 * The Postgres variables carry libpq's names (PGHOST, PGUSER, ...), so psql
 * reads the same values. PGUSER and PGPASSWORD have no default: without
 * them the pool signs in as the logged-in user, with no password, which is
 * how Postgres lets a local user in under its own name.
 *
 * The last three values are fixed numbers and a fixed name, not variables.
 */

/** A comma separated list: each item trimmed, a trailing slash dropped, empty items left out. A list with no item is refused at the start. */
function list(name, fallback) {
  const items = (process.env[name] ?? fallback)
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter((item) => item !== '');
  if (items.length === 0) throw new Error(`${name} must list at least one item`);
  return Object.freeze(items);
}

function integer(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${name} must be a positive integer, got "${value}"`);
  return Number(value);
}

/** A positive integer no larger than 100: a percent. */
function percent(name, fallback) {
  const value = integer(name, fallback);
  if (value > 100) throw new Error(`${name} must be 1 to 100, got "${value}"`);
  return value;
}

/** A variable's trimmed value; `fallback` when it is unset. An empty value is refused at the start. */
function text(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value.trim() === '') throw new Error(`${name} must not be empty`);
  return value.trim();
}

/** A variable's value, or undefined when it is unset or empty: the Postgres user and password, which the pool can do without. */
function optional(name) {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

const webOrigins = list('WEB_ORIGIN', 'http://localhost:4210,http://localhost:4400');

export const config = Object.freeze({
  /** Where the server listens, on loopback. On monitor1 nginx stands in front of it. */
  port: integer('PORT', 4400),
  /** The origins the passkey checks accept: ng serve and this server on the operator's machine, https://monitor.anocloud.com on monitor1. */
  webOrigins,
  /** The passkeys' relying-party id: localhost on the operator's machine, monitor.anocloud.com on monitor1. */
  rpId: text('RP_ID', 'localhost'),
  /** The session cookie is marked Secure when every origin in WEB_ORIGIN starts with https:. */
  cookieSecure: webOrigins.every((origin) => origin.startsWith('https:')),
  /** Postgres. `host` is an address, or the folder of the local socket (/var/run/postgresql on monitor1). `user` and `password` are undefined when not set. */
  db: Object.freeze({
    host: text('PGHOST', '127.0.0.1'),
    port: integer('PGPORT', 5432),
    database: text('PGDATABASE', 'monitor'),
    user: optional('PGUSER'),
    password: optional('PGPASSWORD'),
  }),
  /** The registry file on GitHub main: the list of validators, the file the validators themselves pull. */
  registryUrl: text('REGISTRY_URL', 'https://raw.githubusercontent.com/Anosphere/anosvalidator/main/network/testnet.registry.json'),
  /** The three repositories whose newest commit on main the validators', the doormen's and the keyholders' own commits are compared with. */
  validatorRepo: text('VALIDATOR_REPO', 'https://github.com/Anosphere/anosvalidator.git'),
  doormanRepo: text('DOORMAN_REPO', 'https://github.com/Anosphere/anosvalidatornode.git'),
  keyholderRepo: text('KEYHOLDER_REPO', 'https://github.com/Anosphere/anoskeyholder.git'),
  /** From the start of one sweep to the start of the next, in seconds. */
  sweepSeconds: integer('SWEEP_SECONDS', 60),
  /** How long one answer may take, in seconds. */
  answerTimeoutSeconds: integer('ANSWER_TIMEOUT_SECONDS', 10),
  /** How often the registry and the three commits are read from GitHub, in minutes. */
  githubMinutes: integer('GITHUB_MINUTES', 10),
  /** How long a sign-in lasts, in days. */
  sessionDays: integer('SESSION_DAYS', 30),
  /** A doorman's certificate with fewer days left than this is a problem. */
  certificateWarnDays: integer('CERTIFICATE_WARN_DAYS', 3),
  /** The validators' own floor, IGNORE_FLOOR_PERCENT in anossoftware's network/testnet.env. The floor on the screen is worked out from it, so the two must agree. */
  ignoreFloorPercent: percent('IGNORE_FLOOR_PERCENT', 51),
  /** The Angular build the server hands out. */
  distDir: process.env.DIST_DIR ?? 'dist/monitor/browser',
  /** The name the monitor gives in every request it makes, so a banker who reads a doorman's access log sees what asks every minute. */
  userAgent: 'anosmonitor',
  /** The longest answer read from a doorman, in bytes. A longer one counts as no answer. */
  answerMaxBytes: 64 * 1024,
  /** How long one read from GitHub may take, in milliseconds: the registry file, and each git ls-remote. */
  githubTimeoutMs: 15_000,
});
