# monitor: the record

The settings, the tables, the states and the rules of the monitor, and at
the end the notes: every choice the build made where the plan is silent.

Built from `~/Desktop/Z-TestNet/forclaude/monitor-plan-1.md` (FINAL,
2026-11-17), in that plan's four steps. Sections 1 to 7 and 9 to 11 carry
the plan's own numbers, so "section 6.3" means the same here and there.
The plan's section 8, what cannot be seen from outside, holds nothing
that is built, so this file has no section 8.

**Step 1, the project and the sweep, 2026-11-17.** The folder, the
packages, the settings, the tables, the registry, the sweep, the newest
commits on GitHub, and `GET /api/health`. After this step the server
sweeps and logs, and nothing shows the result yet. Checked with
`node --check` on every file under `server/`, and with nothing else: the
server was not started and no database was made. The first start is the
test.

**Step 2, the door and the overview, 2026-11-17.** The passkey checks,
the challenges, the session, the door's routes, the headers, and the two
routes of the overview. After this step the server answers everything the
page will ask, and there is no page yet. Checked with `node --check` on
every file under `server/`, and with nothing else: the server was still
not started, no database was made, and no passkey was ever checked.

**Step 3, the page, 2026-11-17.** The Angular packages, the settings of
the build, everything under `src/`, and the server handing out the build.
After this step the monitor has its screen: the sign-in by passkey, the
overview and the passkeys. Checked with `node --check` on every file
under `server/` and with `npx ng build`, which ended without an error or
a warning. A second reader then read the page against the server's
routes, and ran the page's three small helpers (times, hex, base64url)
once, in one line of Node. With nothing else: the server was still not
started, no database was made, `ng serve` was not run, and no browser
has shown the page. The first look is the operator's.

## 1. The project

A small server of its own asks every doorman's public `/health` once a
minute and keeps what it learns. It only looks: no key to any validator,
no button that changes anything outside the monitor.

The files so far:

```text
monitorsoftware/
  README.md  LICENSE  .gitignore
  package.json  package-lock.json
  angular.json  tsconfig.json  tsconfig.app.json  proxy.conf.json
  db/schema.sql                       the tables
  server/
    index.js                          the start: settings, schema, registry, sweeps, listen
    config.js                         the settings, each with a local default
    app.js                            the Express app: headers, routes, the Angular build
    db/pool.js  db/schema.js          the pool; applying db/schema.sql at the start
    registry/registry.js              reading, checking, hashing and keeping the registry
    sweep/ask.js                      one GET with the time limit and the size limit
    sweep/sweep.js                    one sweep: asking everyone; the clock; the newest sweep in memory
    sweep/network.js                  the network's view
    sweep/states.js                   one validator's state; the two-sweep rule
    sweep/history.js                  the two history tables and their log lines
    software/github.js                the newest commits on GitHub main
    auth/webauthn.js                  the passkey checks
    auth/challenges.js                the challenges, in memory
    auth/sessions.js                  the cookie and the sessions table
    auth/auth.routes.js               /api/session, /api/passkey/..., /api/passkeys, /api/sign-out
    overview/overview.routes.js       /api/overview, /api/validators/:id/history
  src/                                the Angular app (section 11)
    index.html  main.ts               the page's one HTML file; the start
    styles.css  material-theme.scss   the page's own styles and its four colours; the Material theme
    app/app.ts  app.html  app.css     the shell: the bar on top, the page under it
    app/app.config.ts  app.routes.ts  what the app is made with; the three routes
    app/session.guard.ts              sends a visitor who is not signed in to /sign-in
    app/pages/sign-in/                sign-in.page.ts, .html, .css
    app/pages/overview/               overview.page.ts, .html, .css
                                      validator-details.component.ts, .html, .css
                                      parts.component.ts
    app/pages/passkeys/               passkeys.page.ts, .html, .css
    app/services/api.service.ts       the calls to the server, and the shape of every answer
    app/services/passkey.service.ts   the two passkey calls
    app/words.ts                      every sentence the page shows
  docs/schemas.md                     this file
```

`package.json`: name `monitor`, private, `"type": "module"`, license
Apache-2.0, the wallet's three scripts (`start` = `ng serve`, `build` =
`ng build`, `server` = `node server/index.js`). The server's four
packages, at the versions the other projects hold: `express` 5.3.0 (the
wallet's), `pg` 8.23.1, `canonicalize` 5.1.0 and `@simplewebauthn/server`
14.0.3 (the masterpod's). Since step 3 the page's too: the Angular,
Material, CDK, rxjs and tslib entries of the wallet's `package.json` and
its five dev dependencies, each with the wallet's own version range. The
lock file holds them at the versions the wallet's lock file holds:
Angular 22.2.3, Material and CDK 22.2.4, the Angular CLI and its build
package 22.2.4, rxjs 7.8.2, TypeScript 6.0.3, prettier 3.9.10. One
differs: tslib is 2.9.1 here and 2.8.1 in the wallet (Notes, Step 3).

The start (`server/index.js`), in order: the settings; `db/schema.sql`
applied; the sessions that are past their time deleted; the registry (the
kept copy, then GitHub); the newest commits on GitHub; the sweeps; the
listen on `PORT`, on 127.0.0.1. It prints where it listens, the origins,
the relying-party id, the database, the registry address, the sweep's two
numbers and the build folder. A database that cannot be reached stops the
start with one line.

`GET /api/health`, open to anyone:
`{ "status": "ok", "lastSweepAt": <time or null> }`. `lastSweepAt` is
when the newest sweep started, null before the first. Every other route
is in section 9.4.

## 2. The settings

`server/config.js` reads them once at the start. Every one has a local
default, so the operator's own machine needs no env file. On monitor1
they will come from the committed file `network/monitor.env` (step 4).

| variable | local default | on monitor1 | what it is |
|---|---|---|---|
| `PORT` | `4400` | `4400` | where the server listens, on loopback behind nginx |
| `WEB_ORIGIN` | `http://localhost:4210,http://localhost:4400` | `https://monitor.anocloud.com` | the origins the passkey checks accept, comma separated |
| `RP_ID` | `localhost` | `monitor.anocloud.com` | the passkeys' relying-party id |
| `PGHOST` | `127.0.0.1` | `/var/run/postgresql` | Postgres: an address, or the folder of the local socket |
| `PGPORT` | `5432` | not set | |
| `PGDATABASE` | `monitor` | `monitor` | |
| `PGUSER` | not set (the pool then takes the logged-in user) | `monitor` | |
| `PGPASSWORD` | not set | not set | never needed on monitor1 |
| `REGISTRY_URL` | the same as on monitor1 | `https://raw.githubusercontent.com/Anosphere/anosvalidator/main/network/testnet.registry.json` | the registry file on GitHub `main` |
| `VALIDATOR_REPO` | the same | `https://github.com/Anosphere/anosvalidator.git` | whose `main` the validators' commit is compared with |
| `DOORMAN_REPO` | the same | `https://github.com/Anosphere/anosvalidatornode.git` | the same for the doormen |
| `KEYHOLDER_REPO` | the same | `https://github.com/Anosphere/anoskeyholder.git` | the same for the keyholders |
| `SWEEP_SECONDS` | `60` | `60` | from the start of one sweep to the start of the next |
| `ANSWER_TIMEOUT_SECONDS` | `10` | `10` | how long one answer may take |
| `GITHUB_MINUTES` | `10` | `10` | how often the registry and the three commits are read |
| `SESSION_DAYS` | `30` | `30` | how long a sign-in lasts |
| `CERTIFICATE_WARN_DAYS` | `3` | `3` | a doorman's certificate with fewer days left is a problem |
| `IGNORE_FLOOR_PERCENT` | `51` | `51` | the validators' own number, in `anossoftware/network/testnet.env`; the two must agree |
| `DIST_DIR` | `dist/monitor/browser` | not set | the Angular build the server hands out |

On the operator's machine the monitor reads the real registry and sweeps
the real network. Those are the same public reads as on monitor1.

The cookie is marked `Secure` when every origin in `WEB_ORIGIN` starts
with `https:`. `config.cookieSecure` holds that answer.

A whole-number variable must be a positive integer, and
`IGNORE_FLOOR_PERCENT` at most 100; anything else stops the start with a
line that names the variable. `WEB_ORIGIN` must list at least one origin.

Three values in `server/config.js` are fixed, not variables:

| value | what it is |
|---|---|
| `userAgent`, `anosmonitor` | the name the monitor gives in every request it makes, so a banker who reads a doorman's access log sees what asks every minute |
| `answerMaxBytes`, 64 KB | the longest answer read from a doorman |
| `githubTimeoutMs`, 15 seconds | how long one read from GitHub may take: the registry file, and each `git ls-remote` |

## 3. The tables

`db/schema.sql`, applied by `server/db/schema.js` at every start, before
anything else uses the database. Every statement is
`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` or a `COMMENT`,
so the file is safe to repeat and a pull never needs a schema step by
hand. A later change to a table is written as
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Every table and column has a
`COMMENT`; `\d+ <table>` in psql shows them. The file runs as one
transaction.

```sql
CREATE TABLE IF NOT EXISTS owner (
  only_row   BOOLEAN     PRIMARY KEY DEFAULT true CHECK (only_row),
  handle     BYTEA       NOT NULL CHECK (octet_length(handle) = 16),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS passkeys (
  id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  credential_id BYTEA       NOT NULL UNIQUE,
  public_key    BYTEA       NOT NULL,
  label         TEXT        NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash BYTEA       PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  passkey_id BIGINT      NOT NULL REFERENCES passkeys (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS registry_copy (
  only_row   BOOLEAN     PRIMARY KEY DEFAULT true CHECK (only_row),
  body       JSONB       NOT NULL,
  hash       TEXT        NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  fetched_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS validator_states (
  id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  validator_id INTEGER     NOT NULL,
  state        TEXT        NOT NULL,
  detail       TEXT        NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL,
  ended_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS validator_states_open
  ON validator_states (validator_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS validator_states_by_validator
  ON validator_states (validator_id, started_at DESC);

CREATE TABLE IF NOT EXISTS sweeps (
  swept_at      TIMESTAMPTZ PRIMARY KEY,
  took_ms       INTEGER     NOT NULL,
  active        INTEGER     NOT NULL,
  reached       INTEGER     NOT NULL,
  counted       INTEGER,
  keyholders_up INTEGER,
  position      BIGINT,
  leader        INTEGER
);
```

- `owner`: one row, made with the first passkey. `handle` is the 16 random
  bytes every passkey of the owner carries as its user handle.
- `passkeys`: the allowed passkeys. `credential_id` and `public_key` are
  what the passkey check returns.
- `sessions`: one row for each sign-in. `token_hash` is the SHA-256 of the
  cookie's value; the value itself is not stored. Removing a passkey
  removes its sessions.
- `registry_copy`: one row, the last registry read from GitHub that passed
  the checks, with its hash. `body` is the registry as it was checked:
  `{ firstLeader, validators: [{ id, publicKey, url, active }] }`.
- `validator_states`: one row for each stretch of time a validator spent
  in a state. The row with `ended_at` null is the state it is in now.
  `detail` is one short line about the moment the state began, for the
  history list; it may be empty.
- `sweeps`: one row for each sweep. `reached` is how many validators
  answered on port 3000. `counted`, `keyholders_up`, `position` and
  `leader` are null for a sweep that reached nobody.

`owner`, `passkeys` and `sessions` are the door's (section 9). The passkey
challenges are not a table; they live in the server's memory (section
9.2).

## 4. The registry

`server/registry/registry.js`.

- At the start it takes the row of `registry_copy`, if there is one. Then,
  and every `GITHUB_MINUTES` after that, it reads `REGISTRY_URL`, with 15
  seconds for the read.
- The file must have the validators' shape, the checks of
  `anossoftware/src/validators/registry.service.js`: a JSON object with
  `firstLeader` and `validators`; `validators` a non-empty array; each row
  an `id` that is a positive integer and appears once, a `publicKey` of 66
  lowercase hex characters, a `url` that starts with `http://` or
  `https://` and has no trailing slash, and `active` true or false;
  `firstLeader` null or the id of a row in the file. The validator's check
  of its own row is left out: the monitor has no row.
- A file that passes is kept in memory and written to `registry_copy`,
  with its hash. The hash is the validators' own rule: the SHA-256 of the
  canonical JSON (the `canonicalize` package) of the array of rows,
  ordered by id, each row `{ id, publicKey, url, active }`. So the hash
  worked out from GitHub's file can be compared with the hash the
  validators report.
- A read that fails, or a file that does not pass, changes nothing: the
  monitor goes on with the registry it has, and logs one line.
- With no registry at all (a first start that cannot read GitHub) there is
  no sweep.

A row with `active` false is not asked, and it is left out of every count.

The log gets one line when a registry is first taken and when its hash
changes: `registry 1076ef27d932d8b3, 25 active, read from GitHub`. At a
start with a kept copy the line ends
`the copy read from GitHub on <time>`.

## 5. The sweep

`server/sweep/ask.js` and `server/sweep/sweep.js`.

- The first sweep runs as soon as a registry is there. After that one
  starts every `SWEEP_SECONDS`, counted from start to start. If a sweep is
  still running when the next is due, that one is skipped, with one log
  line.
- For each active row, two GETs at once: `<url>/health`, and the keyholder
  door's `/health`. All rows at once. A validator's keyholder door is its
  registry address with the port 3000 replaced by 3200. A row whose
  address does not end in `:3000` gets no keyholder check.
- Each GET: Node's `fetch`, the header `User-Agent: anosmonitor`, no
  redirect followed, `ANSWER_TIMEOUT_SECONDS` to finish, the certificate
  checked the normal way. The body is read up to 64 KB and parsed as JSON.
- The result of one GET is either an answer (the HTTP status, the
  milliseconds it took, the parsed object) or no answer with a short
  reason. Any HTTP status with a JSON object is an answer. A body longer
  than 64 KB, or one that is not a JSON object, counts as no answer.
- A field that is missing or of the wrong kind is read as null. The
  monitor never stops over an answer's shape.

The short reasons: `timeout`; `connection refused`;
`certificate: <what is wrong with it>`; `too long`; `not JSON`; for
anything else the error's code, such as `ECONNRESET` or `EHOSTUNREACH`. A
reason is cut at 80 characters.

The fields read, and the kind each must be:

| read as | from the answer on port 3000 | kind |
|---|---|---|
| `doorman.commit` | `doorman.version.commit` | a commit |
| `doorman.registryHash` | `doorman.registry.hash` | a hash |
| `doorman.registryActive` | `doorman.registry.active` | a whole number |
| `doorman.uptimeSeconds` | `uptime` | a number, not negative, rounded |
| `doorman.certificateDaysLeft` | `doorman.certificate.daysLeft` | a number |
| `doorman.certificateNotAfter` | `doorman.certificate.notAfter` | a text that reads as a date |
| `worker` | `worker` | an object, else null |
| `worker.status` | `worker.status` | a text |
| `worker.commit` | `worker.version.commit` | a commit |
| `worker.registryHash` | `worker.registry.hash` | a hash |
| `worker.uptimeSeconds` | `worker.uptime` | a number, not negative, rounded |
| `worker.dbMs` | `worker.db.latencyMs` | a number |
| `worker.counted` | `worker.counted` | true or false |
| `worker.position` | `worker.chain.position` | a whole number |
| `worker.recordHash` | `worker.chain.recordHash` | a hash |
| `worker.leader` | `worker.leader` | a whole number |
| `worker.ignored` | `worker.ignored` | a list; only its whole numbers are kept |

| read as | from the answer on port 3200 | kind |
|---|---|---|
| `keyholder` | `worker` | an object, else null |
| `keyholder.answerMs` | the milliseconds the answer took | |
| `keyholder.status` | `worker.status` | a text |
| `keyholder.commit` | `worker.version.commit` | a commit |
| `keyholder.uptimeSeconds` | `worker.uptime` | a number, not negative, rounded |
| `keyholder.dbMs` | `worker.db.latencyMs` | a number |
| `keyholder.copiesWaiting` | `worker.copies.waiting` | a whole number |

A commit is 4 to 40 lowercase hex characters. A hash is 64 lowercase hex
characters. A text is at most 64 characters long.

The requests are far under the doormen's limit: two a minute for each
doorman, against five a second. No doorman setting changes, and the
monitor's address is on no allowlist.

The newest sweep is kept in memory (`newestSweep()` in
`server/sweep/sweep.js`): its time, how long it took, how many it reached,
the numbers on top, the usual commits and the usual registry hash, and for
each active row what the screen shows and this sweep's fields. The
answers themselves are not stored anywhere.

## 6. What the answers mean

### 6.1 Words

- A validator **answered** when its GET on port 3000 gave an answer.
- Its **worker** is the `worker` object of that answer.
- The **tail** is a pair, a chain position and a record hash.
- A worker **has a chain** when both halves of its tail are known.

### 6.2 The network's view

`server/sweep/network.js`. Worked out new in every sweep, from the active
rows.

1. The first voters: every validator that answered and whose worker is an
   object, says `status` `ok`, says `counted` true, and has a chain.
2. **Ignored by most**: an id that is on the `ignored` list of more than
   half of the first voters.
3. The voters: the first voters without the ones ignored by most.
4. The network's **tail**: the tail most voters report. On a tie, the
   higher position.
5. The network's **leader**: the leader most of the voters at that tail
   name.
6. **Quiet**: true when the network's tail is the same as in the sweep
   before. False in the first sweep after a start.
7. The usual commits: for the validator, the doorman and the keyholder,
   the commit most of the answers carry, and how many carry it.
8. The usual registry hash: the hash most of the doormen's and workers'
   answers carry, counted together.

With no voters there is no tail and no leader.

### 6.3 One validator's state

`server/sweep/states.js`. The first that fits, in this order.

| # | key | the tile says | colour | when |
|---|---|---|---|---|
| 1 | `noAnswer` | No answer | red | it did not answer on port 3000 |
| 2 | `validatorDown` | Validator down | red | it answered, and its worker is null |
| 3 | `databaseDown` | Database down | red | its worker's `status` is not `ok` |
| 4 | `notCounted` | Not counted | red | its worker's `counted` is not true |
| 5 | `votedOut` | Voted out | amber | its id is ignored by most |
| 6 | `outOfStep` | Out of step | amber | see below |
| 7 | `certificate` | Certificate | amber | `doorman.certificate` is null, or has fewer than `CERTIFICATE_WARN_DAYS` days left |
| 8 | `otherSoftware` | Other software | amber | its validator, doorman or keyholder commit is known and is not the usual one |
| 9 | `otherRegistry` | Other registry | amber | its doorman's or its worker's registry hash is not the usual one |
| 10 | `keyholderDown` | Keyholder down | amber | port 3200 gave no answer, or the keyholder behind it is null, or its `status` is not `ok` |
| 11 | `good` | Counted | green | none of the above |

Red means it does not work for the network. Amber means it works and
needs a look.

State 6, out of step. The validator has a chain, and one of these holds:

- its position is two or more away from the network's, in either
  direction;
- it stands at the network's position with another record hash;
- the network is quiet, and its tail is not the network's;
- the network is quiet, it stands at the network's tail, and it names
  another leader.

The reason for "quiet": while a record is being written, a sweep can catch
some validators one position ahead of the others for a moment. That is not
a problem. A difference that is still there when the chain has not moved
for a minute is one.

A sweep that reached no validator on port 3000 is not judged at all: no
state is worked out, and nothing the screen shows changes. The monitor's
own connection may be down.

With each state goes a detail, one short line that says what was seen. It
is kept in `validator_states.detail`.

| state | the detail line |
|---|---|
| `noAnswer` | the short reason: `timeout` |
| `validatorDown` | `the doorman answered 503, no validator behind it` |
| `databaseDown` | `status degraded` |
| `notCounted` | `position 639, the network 639` |
| `votedOut` | `ignored by 23 of 24` |
| `outOfStep` | `position 288, the network 415`, or `another record at position 415`, or `names leader 3, the network 22` |
| `certificate` | `1.4 days left`, or `no certificate` |
| `otherSoftware` | `validator 1a2b3c4, most run 6b27427`; two programs are joined with `; ` |
| `otherRegistry` | `doorman 9f8e7d6c, most have 1076ef27` |
| `keyholderDown` | the short reason, or `the doorman answered 503, no keyholder behind it`, or `status degraded` |
| `good` | empty |

### 6.4 The two-sweep rule

Each validator has the state the screen shows, and at most one waiting
state.

- The sweep works out the same state as the screen shows: the waiting
  state is dropped.
- It works out another state, and that is the waiting state: the screen
  now shows it. It began at the time of the first of the two sweeps.
- It works out another state, and that is not the waiting state: it
  becomes the waiting state, with this sweep's time.

So a problem shows within two minutes, and one slow answer does not turn
a tile red.

A validator with no open row in `validator_states` (the monitor's first
sweep ever, or a new registry row) takes the state of its first sweep at
once.

At a start the shown states are the open rows of `validator_states`. If
the monitor was down for a while, the history reads as if the old state
had lasted until the monitor came back. The gap shows in the `sweeps`
table. The waiting states are in memory only, and a start has none.

Whether a validator's keyholder is up follows the same rule, as a second
value of its own. It has no history rows.

### 6.5 The numbers on top

- **Validators counted**: the active validators whose shown state is none
  of the states 1 to 5. Beside it the floor: the smallest whole number
  that, times 100, is at least `IGNORE_FLOOR_PERCENT` times the active
  rows. With 25 rows, 13.
- **Keyholders up**: the active validators whose keyholder is shown as up.
- **Chain position** and **Leader**: the network's, from the newest sweep.

### 6.6 The history

`server/sweep/history.js`.

- When a shown state changes: the validator's open row gets its
  `ended_at`, and a new row is written with the new state, its start, and
  the detail line, both in one transaction. One log line is printed too:
  `validator 24: good -> notCounted`.
- When a registry row turns inactive, its open row is closed, with the
  log line `validator 24: not an active registry row any more`.
- After every sweep, one row in `sweeps`.
- The log gets one summary line for the first sweep after a start and
  then one an hour:
  `sweep 18:25:40Z: 25 of 25 counted, 25 keyholders up, position 639, leader 22, 912 ms`.
  For a sweep that reached nobody it reads
  `sweep 18:25:40Z: reached no validator, the monitor's own connection may be down, 10012 ms`.

A write that fails is logged and not thrown. The screen shows what is in
memory, and the next sweep goes on.

## 7. The software line

`server/software/github.js`. At the start and every `GITHUB_MINUTES`:
`git ls-remote <repo> refs/heads/main` for the three repositories, each
with 15 seconds and with no prompt for a password (`GIT_TERMINAL_PROMPT=0`).
No GitHub token. The 40 characters are kept in memory with the time
(`githubMains()`). A read that fails keeps the older value and logs one
line.

A validator reports a short commit. It is "the newest on GitHub main" when
GitHub's 40 characters begin with it.

The page's sentences (section 11.4) are built from, for each of the three
programs: the usual commit, how many run it, GitHub's newest commit or
null, and whether the two are the same (`softwareLine(usual)`).

During a pull round this line and the amber "Other software" tiles are the
tick sheet: the tiles turn as each banker pulls.

## 9. The door

Only the owner's passkey opens the monitor. While the server holds no
passkey, the first one made is the owner's. From then on nobody makes a
passkey from outside: the page only signs in, and one more passkey is
added from inside, while signed in. There is no setup word, and no
command is run on the server.

The weak moment is the plan's: for the first minutes after the site is
up, whoever makes the first passkey owns it. If every passkey is lost, or
a stranger made the first one, one line on the server empties the list
and ends every session (`delete from passkeys`). The first passkey made
after it is the owner's again.

### 9.1 The checks

`server/auth/webauthn.js` is the masterpod's file,
`masterpodsoftware/src/auth/webauthn.js`, which wraps
`@simplewebauthn/server`, without PRF. The monitor makes no keys; it only
needs to know that it is the owner.

- `verifyRegistration(passkey, challenge)` checks a new passkey and
  returns its credential id and its COSE public key.
- `verifyAuthentication(assertion, challenge, credentialId, publicKey)`
  checks a sign-in against a stored passkey.

Both check the challenge, `RP_ID`, the `WEB_ORIGIN` list and user
verification. The sign counter is ignored: the stored counter is given as
0, so a synced passkey that reports 0 and a hardware key that counts up
both pass. The library throws on every failure; each wrapper turns that
into a reason, and the reason goes to the log.

Both take the passkey in the form the browser's
`PublicKeyCredential.toJSON()` gives it, base64url everywhere.

### 9.2 The challenges

`server/auth/challenges.js`. A challenge is 32 random bytes, handed out
as 64 hex characters. The server keeps it in memory with its purpose for
five minutes, and forgets it when it is used. It keeps 200 at most; the
oldest goes first. One process runs the monitor, so memory is enough. A
restart in the middle of a sign-in means the operator presses the button
again.

A challenge is used the first time a route looks it up, also when the
request is refused after that. So every press of a button asks for a new
challenge.

### 9.3 The session

`server/auth/sessions.js`. A sign-in makes 32 random bytes. Their
base64url form is the cookie's value; their SHA-256 goes into `sessions`
with `expires_at` = now + `SESSION_DAYS`.

The cookie: name `monitor_session`, `HttpOnly`, `SameSite=Strict`,
`Path=/`, `Max-Age` of `SESSION_DAYS` days, and `Secure` when every origin
in `WEB_ORIGIN` starts with `https:`. The page's own scripts cannot read
it.

A request is signed in when its cookie's hash is a row whose `expires_at`
is ahead. The days count from the sign-in, and nothing makes them more:
after `SESSION_DAYS` the passkey is asked for once more. Rows that are
past it are deleted at the start and once an hour.

### 9.4 The routes

All under `/api`, JSON in and out, bodies up to 64 KB. A POST or DELETE
that carries an `Origin` header that is not in `WEB_ORIGIN` is refused
with 403.

Open to anyone:

| route | what it does |
|---|---|
| `GET /api/health` | `{ "status": "ok", "lastSweepAt": <time or null> }` |
| `GET /api/session` | `{ "owner": <is there a passkey>, "signedIn": <true or false> }` |
| `POST /api/passkey/challenge` | body `{ "purpose": "create" \| "signIn" \| "add" }`. `create` only while there is no passkey, else 409 `the owner exists already`. `signIn` only when there is one, else 409 `no owner yet`. `add` only when signed in, else 401. Answers `{ "challenge", "rpId" }`, and for `create` and `add` also `"userHandle"` (32 hex characters) and `"exclude"` (the ids of the passkeys there are, base64url). |
| `POST /api/passkey/create` | body `{ "challenge", "passkey", "label" }`. The challenge must be one handed out for `create`. The registration is checked. Then, in one transaction that only one request at a time can be in: if there is still no passkey, the `owner` row and the passkey are written, and a session starts. Otherwise 409 `the owner exists already`. Answers 201 `{ "signedIn": true }`, with the cookie. |
| `POST /api/passkey/sign-in` | body `{ "challenge", "assertion" }`. The challenge must be one for `signIn`. The passkey is found by the assertion's id, else 401 `unknown passkey`. The assertion is checked, `last_used_at` is set, a session starts. Answers `{ "signedIn": true }`, with the cookie. |

Only when signed in, else 401 `not signed in`:

| route | what it does |
|---|---|
| `POST /api/passkey/add` | body `{ "challenge", "passkey", "label" }`, a challenge for `add`. Writes one more passkey. Answers 201 `{ "id": <the new passkey's id> }`. |
| `GET /api/passkeys` | the list, oldest first: `{ "passkeys": [{ "id", "label", "createdAt", "lastUsedAt", "thisSession" }] }`. `lastUsedAt` is null for a passkey that has not signed in. `thisSession` is true for the one this session signed in with. |
| `DELETE /api/passkeys/:id` | removes one, and with it its sessions. The last one is refused with 409 `the last passkey stays`. Answers `{ "removed": true }`. |
| `POST /api/sign-out` | deletes this session's row and clears the cookie. Answers `{ "signedIn": false }`. |
| `GET /api/overview` | section 10 |
| `GET /api/validators/:id/history` | the validator's last ten rows of `validator_states`, newest first: `{ "history": [{ "state", "detail", "startedAt", "endedAt" }] }` |

The user handle is made when a `create` challenge is handed out, kept with
that challenge, and written to `owner` when the first passkey is. An `add`
challenge carries the handle of the `owner` row. So every passkey of the
owner has the same handle, and a phone lists them as one account.

A label is 1 to 40 characters after trimming. The page sends `Owner` for
the first passkey and asks for a label when one is added.

A refusal is `{ "error": "<a short phrase>" }` with its status:

| status | phrase | when |
|---|---|---|
| 400 | `bad request shape` | the body is not what the route takes |
| 400 | `the label must be 1 to 40 characters` | `create` and `add` |
| 400, 413, 415 | `bad request` | a request that cannot be read: a body that is not JSON or is longer than 64 KB, a path that cannot be decoded |
| 401 | `not signed in` | a route that needs the session, and the challenge for `add` |
| 401 | `unknown or expired challenge` | the challenge was not handed out for this, is older than five minutes, or was used |
| 401 | `unknown passkey` | a sign-in with a passkey that is not in the list |
| 401 | `passkey verification failed` | the passkey check refused, or a new passkey's credential id is not 16 to 1023 bytes; the reason is in the log |
| 403 | `origin not allowed` | a POST or DELETE from another origin |
| 404 | `unknown passkey` | a DELETE for an id that is not in the list |
| 404 | `unknown validator` | a history for an id that is not a whole number above 0 |
| 404 | `Not Found`, with `"path"` | a path under `/api` that no route answers; any other path asked for with another method than GET or HEAD |
| 409 | `the owner exists already` | `create` while there is a passkey |
| 409 | `no owner yet` | `signIn` while there is no passkey; `add` while there is no `owner` row |
| 409 | `this passkey is in the list already` | `add` with a passkey that is there |
| 409 | `the last passkey stays` | a DELETE for the last passkey |
| 500 | `Internal Server Error` | anything else, with one log line |

The door's log lines:

```text
passkey 1: the owner's passkey was made
passkey 1: signed in
passkey 2: added
passkey 2: removed
passkey check failed at sign-in: <the library's reason>
```

### 9.5 What a stranger gets

Whether there is an owner, a challenge, and `GET /api/health`. Also the
sign-in page and the Angular files, which hold no data: the server hands
the build out to anyone (section 11). Every answer with data needs the
session. A person who breaks into monitor1
gets the public keys of the owner's passkeys, the session hashes and a
history of public facts. Nothing on monitor1 opens anything else.

### 9.6 The headers

Set by `server/app.js` on every answer, not by nginx, so the page runs
under the same headers on the operator's own machine as on monitor1:

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
X-Robots-Tag: noindex, nofollow
```

and `Cache-Control: no-store` on every answer under `/api`.

`'unsafe-inline'` for styles is what Angular Material needs. The two
Google hosts are the fonts the page loads. For `script-src 'self'` to
hold, the page's build must write no script into the page itself. So the
production configuration in `angular.json` sets
`"optimization": { "scripts": true, "styles": { "minify": true, "inlineCritical": false }, "fonts": true }`:
with `inlineCritical` on, Angular writes a small script into the page
that this header would block, and the styles would not load. The built
`index.html` holds one script tag, which names the build's own file, and
no script of its own.

The headers go on the build's files too. `ng serve` does not set them:
only the page the server itself hands out runs under them.

The page shows what the validators answer as text only, never as HTML.

## 10. The overview

`server/overview/overview.routes.js`. `GET /api/overview`, signed in. One
answer holds the whole screen. It is put together from memory (the
registry in use, the newest sweep, the newest commits on GitHub main), so
asking often costs nothing.

```json
{
  "sweptAt": "2026-11-17T18:25:40.000Z",
  "tookMs": 912,
  "registryRead": true,
  "reachedNobody": false,
  "stale": false,
  "network": { "active": 25, "counted": 25, "floor": 13, "keyholdersUp": 25,
               "position": 639, "recordHash": "5efff567...", "leader": 22 },
  "problems": [ { "validatorId": 24, "state": "notCounted", "since": "..." } ],
  "validators": [
    { "id": 1, "active": true, "address": "https://35.237.125.139:3000",
      "state": "good", "since": "...", "keyholderUp": true,
      "answerMs": 413, "reason": null,
      "doorman": { "commit": "4cfade2", "registryHash": "1076ef27...", "registryActive": 25,
                   "uptimeSeconds": 397800, "certificateDaysLeft": 4.5, "certificateNotAfter": "..." },
      "worker": { "status": "ok", "commit": "6b27427", "registryHash": "1076ef27...",
                  "uptimeSeconds": 397080, "dbMs": 17, "counted": true, "position": 639,
                  "recordHash": "5efff567...", "leader": 22, "ignored": [] },
      "keyholder": { "answerMs": 404, "status": "ok", "commit": "6d4b89c",
                     "uptimeSeconds": 397080, "dbMs": 2, "copiesWaiting": 0 } }
  ],
  "software": {
    "readAt": "...",
    "validator": { "commit": "6b27427", "running": 25, "main": "6b27427...", "same": true },
    "doorman":   { "commit": "4cfade2", "running": 25, "main": "4cfade2...", "same": true },
    "keyholder": { "commit": "6d4b89c", "running": 25, "main": "6d4b89c...", "same": true }
  },
  "registry": { "hash": "1076ef27...", "rows": 25, "active": 25, "fetchedAt": "...",
                "usual": "1076ef27...", "same": true }
}
```

- `registryRead` is false while no registry is there at all. Then
  `validators` is empty, and `registry` is null.
- `sweptAt` is when the newest sweep started, and `tookMs` how long its
  asking took. Until the first sweep after a start has ended, both are
  null, `network` is null, and no active row has a state.
- `reachedNobody` is true when the newest sweep reached no validator on
  port 3000. Such a sweep is not judged: `state`, `since`, `keyholderUp`,
  `counted` and `keyholdersUp` are what the screen showed before it;
  `position`, `recordHash` and `leader` are null; and no commit and no
  usual hash is known.
- `stale` is true when `sweptAt` is more than three times `SWEEP_SECONDS`
  old.
- `network` is the numbers on top (section 6.5). `position`, `recordHash`
  and `leader` are null too for a sweep with no voters.
- `problems` lists every active validator whose shown state is not `good`,
  red before amber, then by id. Red is the states 1 to 4 of section 6.3.
- `validators` has one entry for each registry row, in id order. `state`
  and `since` are what the screen shows (section 6.4). The fields under
  `doorman`, `worker` and `keyholder` are the newest sweep's, the ones
  the two tables in section 5 name. `doorman` is null when port 3000 gave
  no answer, and `reason` is the short reason then. `worker` and
  `keyholder` are null when there was none. `keyholderUp` is null for a
  row with no keyholder check.
- An inactive row has its `id`, `"active": false`, `"state": "notActive"`,
  and nothing else.
- An active row the newest sweep did not ask, one that turned active
  since, has its `id`, `"active": true`, its `address`, and null in every
  other field, until the next sweep.
- `software`: for each of the three programs the usual commit, how many
  run it, GitHub main's newest commit, and whether GitHub's begins with
  the usual one. `main` is 40 characters, or null until a read worked.
  `readAt` is the oldest of the three reads from GitHub, and null until
  all three have worked once.
- `registry`: `hash`, `rows`, `active` and `fetchedAt` are the registry
  read from GitHub main. `usual` is the hash most validators report, or
  null. `same` says whether the two are the same.

Every time is in UTC, as an ISO text. A hash is whole, 64 characters; the
page cuts it.

`GET /api/validators/:id/history`, signed in. The validator's last ten
rows of `validator_states`, newest first:

```json
{ "history": [
  { "state": "notCounted", "detail": "position 639, the network 639",
    "startedAt": "2026-11-17T14:02:40.000Z", "endedAt": null },
  { "state": "good", "detail": "",
    "startedAt": "2026-11-15T17:10:12.000Z", "endedAt": "2026-11-17T14:02:40.000Z" }
] }
```

`endedAt` is null for the state the validator is in now. An id with no
rows answers an empty list.

## 11. The page

Angular 22 with Material, standalone components and signals, set up as
the wallet is: the two `tsconfig` files and the theme file
`src/material-theme.scss` are the wallet's own, and `angular.json` and
the font links of `src/index.html` follow the wallet's (Notes, Step 3).
The page is in English only, and it fits a phone.

- The project's name is `monitor`. `npx ng build` puts the build into
  `dist/monitor/browser`, which is `DIST_DIR`.
- `server/app.js` hands the build out, behind the routes: its files, and
  its `index.html` for any other GET, so the page's own paths load, also
  after a reload. A path under `/api` that no route answers is 404 as
  JSON before the build is looked at. With no build in the folder, the
  answer is 404 `no build at <folder>: run npm run build`, as plain text.
- `ng serve` listens on port 4210 (`angular.json`) and sends `/api` to
  `http://localhost:4400` (`proxy.conf.json`). It leaves the `Origin`
  header as the browser sent it, and `http://localhost:4210` is in the
  default `WEB_ORIGIN`.

Every sentence the page shows is in `src/app/words.ts`. A sentence with a
number, a time or a name in it is a function there. The server gives a
state's key, never a colour or a sentence: the sentences are in
`words.ts`, the colours in `src/styles.css`.

Every time on the screen is in UTC. A moment on today's UTC day shows its
time alone, `18:25:40 UTC`. One on another day carries the day in front,
`15 Nov 18:25:40 UTC`, and one of another year the year too. How long
something has lasted is a whole number, rounded down: minutes under an
hour, hours under two days, then days; under a minute it reads `less than
a minute`. A commit is cut at 7 characters and a hash at 8. A value that
is not known shows a dash.

The page's scripts ask nothing but the monitor's own server; the fonts
come from Google's two hosts. The page shows what the validators answer
as text only, never as HTML.

### 11.1 The routes

| path | page | who |
|---|---|---|
| `/sign-in` | the sign-in page | anyone |
| `/` | the overview | signed in |
| `/passkeys` | the passkeys | signed in |

Any other path leads to `/`.

`src/app/session.guard.ts` stands in front of the two pages that need the
session. It asks `GET /api/session` and sends a visitor who is not signed
in to `/sign-in`. A server that does not answer counts as not signed in.

An answer 401 `not signed in` from any call sends the page to `/sign-in`
too (`src/app/services/api.service.ts`). The door's other 401s (a
challenge that is used or too old, a passkey the server does not know or
does not accept) are refusals of that one request: the page that made it
shows their line and stays.

The shell (`src/app/app.html`) is a bar on top and the page under it. The
bar has the title, which is a link to the overview, and on the right a
menu with "Passkeys" and "Sign out". It shows only while the browser is
signed in, so the sign-in page stands alone. "Sign out" asks
`POST /api/sign-out` and goes to `/sign-in`.

`src/app/services/api.service.ts` has one method for each route of
section 9.4 and the two of section 10. A call never throws over an
answer: it gives the answer's body, or the refusal's status and the
server's phrase. A call gets 20 seconds; past them it counts as not
answered, with the status 0, like a server that is down.

### 11.2 The passkey calls

`src/app/services/passkey.service.ts` is the wallet's
(`web_app/src/app/services/passkey.service.ts`) without PRF and without
the language service: the two calls of `navigator.credentials`, and its
helpers `toBuffer`, `asPublicKeyCredential`, `toJson` and `toBase64Url`
as they are. `toJson` stays built by hand.

- Making a passkey: `rp` `{ name: "anos monitor", id: rpId }`; `user`
  `{ id: <the user handle>, name: "owner", displayName: "Monitor owner" }`;
  the challenge; ES256 and RS256; `residentKey` `required`,
  `userVerification` `required`; `attestation` `none`;
  `excludeCredentials` from `exclude`; two minutes.
- Signing in: the challenge, `rpId`, `userVerification` `required`, two
  minutes. No list of allowed passkeys: the phone offers the one it has.

The challenge, `rpId`, the user handle and `exclude` come from
`POST /api/passkey/challenge`. The challenge and the user handle are hex
and become bytes; each id in `exclude` is base64url and becomes bytes.
The two small helpers for that are written by hand in the same file.

Every press of a button asks for a new challenge.

### 11.3 The sign-in page

`src/app/pages/sign-in/`. The title "Validator monitor" and one button.
What the button says comes from `GET /api/session`:

| the server says | the button | under it |
|---|---|---|
| no owner yet | Make the owner's passkey | The first passkey made here is the owner's. After that, this page only signs in. |
| an owner exists | Sign in | |
| nothing: it did not answer | Try again | the failure's line |

A browser that is signed in already goes on to the overview.

- "Make the owner's passkey": a `create` challenge, the passkey call,
  `POST /api/passkey/create` with the label `Owner`.
- "Sign in": a `signIn` challenge, the passkey call,
  `POST /api/passkey/sign-in`.
- "Try again": asks `GET /api/session` once more.

A failure shows one line under the button, above the note. After a
sign-in the page goes to the overview. A refusal 409 means that the door
is not as the page showed it (an owner's passkey was made meanwhile, or
the list was emptied on the server): the page asks `GET /api/session`
again, and the button follows.

The guard in front of the overview asks the server once more whether the
browser is signed in. When it does not find the session right after a
sign-in, the page is still the sign-in page. It then asks
`GET /api/session` itself and says why: the server does not answer, or
the browser did not keep the session's cookie.

The failure lines, here and on the passkeys page:

| what happened | the line |
|---|---|
| nothing came back, or a status from 502 up | The monitor's server does not answer. |
| 401 `unknown or expired challenge` | That took too long. Press the button again. |
| 401 `unknown passkey` | This passkey is not one of the owner's. |
| 401 `passkey verification failed` | The server did not accept this passkey. |
| 401 `not signed in` | You are not signed in any more. |
| 403 `origin not allowed` | The server takes no requests from this address. |
| 404 `unknown passkey` | That passkey is not in the list any more. |
| 409 `the owner exists already` | The owner's passkey exists already. Sign in with it. |
| 409 `no owner yet` | The server holds no passkey. The first one made is the owner's. |
| 409 `this passkey is in the list already` | This passkey is in the list already. |
| 409 `the last passkey stays` | The last passkey stays. |
| 400 `the label must be 1 to 40 characters` | A label has 1 to 40 characters. |
| any other refusal | The monitor's server answered with an error (HTTP 500). |
| a sign-in went through, and the next answer says "not signed in" | The sign-in went through, but this browser did not keep it. It has to accept the monitor's cookie. |
| the passkey call: `NotAllowedError` (cancelled, timed out, not allowed) | No passkey was used. Press the button to try again. |
| the passkey call: `InvalidStateError` (the device holds one already) | This device holds one of the owner's passkeys already. |
| the passkey call: anything else | "The passkey did not work:", then the browser's own message |

### 11.4 The overview

`src/app/pages/overview/`. From top to bottom:

1. The shell's bar: the title, and on the right the menu with "Passkeys"
   and "Sign out".
2. Four cards: "Validators counted" with `25 of 25` and under it "Floor
   is 13"; "Keyholders up" with `25 of 25`; "Chain position"; "Leader".
   Four in a row, two on a phone.
3. The problem line, or the line that stands in its place.
4. The tiles, one for each registry row, in id order: the number, and
   under it what the tile says (section 6.3). Five in a row on a wide
   screen, four under 840 pixels, three under 600. The tile's colour is
   its state's. The tapped tile has a stronger border.
5. The details of the tapped tile (section 11.5).
6. The software line and the registry line.

The page asks `/api/overview` when it opens and every 15 seconds after.

The colours:

| colour | what |
|---|---|
| red | the states 1 to 4 of section 6.3 |
| amber | the states 5 to 10 |
| green | `good` |
| grey | `notActive`; a row no sweep has judged yet, which says a dash |

The line under the cards is the first of these that fits:

| # | when | the line | colour |
|---|---|---|---|
| 1 | the page's newest ask got no answer, or a refusal | the failure's line (section 11.3), then "This screen is from 18:26:10 UTC." | red |
| 2 | `registryRead` is false | No registry read yet. | grey |
| 3 | `sweptAt` is null | The first sweep is running. | grey |
| 4 | `reachedNobody` | The monitor reached no validator in its last sweep. Its own connection may be down. | red |
| 5 | `stale` | The monitor has not swept since 18:25:40 UTC. | red |
| 6 | no problems | No problems. Last sweep 18:25:40 UTC. | green |
| 7 | problems | the sentences of up to three problems, the worst first, then "And 2 more." when there are more, then "Last sweep 18:25:40 UTC." | red when a red state is among the problems, else amber |

In case 1 the rest of the screen stays as the last answer left it. Before
the first answer the page shows a moving bar and nothing else.

The problem sentences, with N the validator's id:

| state | sentence |
|---|---|
| `noAnswer` | Validator N does not answer. |
| `validatorDown` | Validator N: the doorman answers, the validator behind it does not. |
| `databaseDown` | Validator N: its database does not answer. |
| `notCounted` | Validator N answers but is not counted. |
| `votedOut` | Validator N is voted out by the others. |
| `outOfStep` | Validator N is out of step with the others. |
| `certificate` | Validator N: its certificate ends in 1.4 days. Or: Validator N has no certificate. Or, when the doorman did not answer the newest sweep: Validator N: its certificate needs a look. |
| `otherSoftware` | Validator N runs other software than most. |
| `otherRegistry` | Validator N has another registry than most. |
| `keyholderDown` | Validator N: its keyholder does not answer. |

The tapped tile. At the start it is the first problem's, or the first
row's when there is no problem. The page chooses once, at the first
answer that carries a sweep. After that only a tap changes it, unless the
tapped row has left the registry: then the page chooses again.

The software line is put together from `software` and `network.active`:

- What runs: "Software: all 25 run validator `6b27427`, doorman
  `4cfade2` and keyholder `6d4b89c`". "All 25" stands when all three
  commits are known and each `running` is `network.active`. Else it
  reads "most run"; the validators that run something else show as amber
  tiles. A commit that is not known shows a dash. When no commit is known
  at all, this sentence is left out.
- GitHub was read, and all three are the newest: the sentence ends ",
  the newest on GitHub main."
- GitHub was read, and it is ahead for a program: the sentence ends with
  a full stop, then "GitHub main is newer for the validator: `1a2b3c4`.",
  one such sentence for each program whose commit is known and whose
  `same` is false.
- GitHub was not read: the sentence ends with a full stop, then "GitHub
  was not read since 18:20 UTC.", or "GitHub was not read yet." while
  `software.readAt` is null. GitHub counts as not read when
  `software.readAt` is null or more than 30 minutes old.
- Nothing of all this can be said: "Software: –".

The registry line: "Registry: 25 active rows. The validators applied the
registry on GitHub main (`1076ef27`)." When the two differ, the second
sentence is "GitHub main's registry (`9f8e7d6c`) is not the one most
validators applied (`1076ef27`)." While `registry.usual` is null, the
second sentence is left out. While `registry` is null the line reads
"Registry: –".

### 11.5 The details of one validator

`src/app/pages/overview/validator-details.component.ts`. A card under the
tiles, with the title "Validator 24" and a label and a value in each row.
On a phone the label stands over its value.

| row | value |
|---|---|
| State | what the tile says, then when it began and how long it has lasted: "Not counted since 14:02 UTC, 2 hours" |
| (the help line) | only for "Not counted", under the state, see below |
| Chain position | the position and the first 8 characters of the record hash: `639 (5efff567)` |
| Leader it names | the id |
| Counted | yes or no |
| Ignores | the ids, or "nobody" |
| Validator running for | from the worker's uptime |
| Database answer | milliseconds, as a whole number: `17 ms` |
| Doorman running for | from the doorman's uptime |
| Certificate | days left, and the day it ends: `4.5 days left, ends 22 Nov`; "no certificate" when the doorman answered and has none |
| Answer time | milliseconds: `413 ms`; when port 3000 gave no answer, the short reason: `no answer: timeout` |
| Software | the three commits: `validator 6b27427, doorman 4cfade2, keyholder 6d4b89c` |
| Registry | the registry the doorman read, with its count of active rows, and the one the validator applied: `doorman 1076ef27, 25 active; validator 1076ef27` |
| Keyholder | Up or Down, running for, shares waiting: `Up, running for 4 days, 0 shares waiting` |
| Address | the registry address |
| Earlier | the last ten states with their times, from `/api/validators/:id/history` |

The state and its time, and Up or Down, are what the screen shows (the
two-sweep rule). Every other row is the newest sweep's.

A value that is not known shows a dash: a field the answer did not
carry; the validator's rows when the doorman answered alone; the
doorman's and the validator's rows when port 3000 gave no answer; and
every row but the state of a registry row that is not active.

The help line for "Not counted": "If it stays this way for some minutes,
the banker restarts the program on the worker:
`sudo systemctl restart anos-validator`. While it stands at the network's
chain position and is not counted, nothing can land."

Earlier is the list as the route gives it, newest first, the state the
validator is in now included: "Not counted since 14:02 UTC" for that one,
"Counted, 15 Nov 17:10 UTC to 14:02 UTC" for one that ended. Under each,
in smaller letters, its detail line when it has one. The page reads the
history when a tile is tapped, and again when the tapped validator's
state has changed.

### 11.6 The passkeys page

`src/app/pages/passkeys/`. The title "Passkeys", and under it the link
"Back to the overview".

The list of passkeys, oldest first: the label; the mark "This browser
signed in with it" on that one; "Added 17 Nov 2026 14:02 UTC, last used
17 Nov 2026 18:20 UTC", or "Added 17 Nov 2026 14:02 UTC, not used since"
for one that has not signed in since it was added. The times carry their
day and year always.

The page reads the list when it opens, and again after a passkey was
added or removed.

"Add a passkey" opens a text box for the label, with "Make the passkey"
and "Cancel". The label is checked on the page before the passkey call: 1
to 40 characters after trimming. Then an `add` challenge, the passkey
call, `POST /api/passkey/add`, and the list is read again.

Each row has "Remove". A press makes the row ask once: `Remove "Phone"?`
with "Yes, remove" and "Keep". For the passkey this browser signed in
with, the question adds that the browser will be signed out. "Yes,
remove" asks `DELETE /api/passkeys/:id` and reads the list again. The
last passkey has no "Remove".

A failure shows one line under the list (section 11.3).

## Notes

Every choice the build made where the plan is silent.

### Step 1 (2026-11-17)

The project:

- `package.json` has the wallet's three scripts from the start, as section
  1 of the plan lists them. `start` and `build` call `ng`, which comes
  with the Angular packages in step 3; until then only `npm run server`
  works. The version is `0.0.0`, as the wallet's. No `packageManager` and
  no `engines` entry.
- npm ran twice, not once. The first `npm install` took
  `@simplewebauthn/server` 14.1.0, the newest that `^14.0.3` allows. The
  masterpod's lock file holds 14.0.3, and between the two versions the
  two checks the masterpod's passkey code wraps were changed. So
  `npm install @simplewebauthn/server@14.0.3` set the lock file to the
  version the masterpod holds. `package.json` still says `^14.0.3`.
- The server listens on 127.0.0.1 only, as the settings table says ("on
  loopback"). The wallet's server listens on every interface.
- `LICENSE` is a copy of the wallet's file, byte for byte.
- The README's "Running it on this machine" also shows the start lines,
  the health address and one `psql` line that lists each validator's
  state, because nothing else shows them yet.
- Sections 1 to 7 of this file carry the plan's numbers.

The settings:

- The `Secure` rule of the cookie is worked out in `server/config.js`
  already (`cookieSecure`). Nothing reads it before step 2.
- The three fixed values (`userAgent`, `answerMaxBytes`,
  `githubTimeoutMs`) sit in `server/config.js` beside the variables, as
  the wallet's fixed numbers do.
- A whole-number variable that is set but empty takes its default. A text
  variable that is set but empty stops the start.

The database:

- `withTransaction` sits in `server/db/pool.js`. The layout names no third
  file under `server/db/`.
- A database that cannot be reached at the start stops the start, as in
  the other servers. After the start, a history write that fails is
  logged, and the sweep goes on.

The registry:

- `registry_copy.body` holds the registry as it was checked, the rows
  ordered by id and cut down to their four fields, not the file's own
  text.
- At a start the kept copy goes through the same checks again, and its
  hash is worked out again from its rows. A copy that does not pass is
  logged and not used.
- With a kept copy the first sweep runs at once, on the copy. The read
  from GitHub goes on beside it.
- Every read that passes rewrites the row of `registry_copy`, so
  `fetched_at` is the time of the last good read, also when nothing
  changed.
- GitHub must answer 200. The `User-Agent` header goes to GitHub too.
- The registry line is logged when a registry is first taken and when its
  hash changes, not at every read.
- A row that left the file altogether is treated as one that turned
  inactive: its open history row is closed.
- The validators' message for a `publicKey` that is still `<fill in>` is
  kept, without the file's name.

The sweep:

- What "the wrong kind" means for each field is the table in section 5. A
  commit must be 4 to 40 lowercase hex characters, a hash 64, a text at
  most 64 characters. So nothing an answer carries reaches the log or the
  history unless it has the shape it should have.
- The doorman's own fields are read from its answer on port 3000 only.
  The answer on port 3200 gives the keyholder's fields.
- `took_ms` is the time the asking took, from the first request to the
  last answer.
- The short reasons for no answer are `timeout`, `connection refused`,
  `certificate: ...`, `too long`, `not JSON`, and else the error's code,
  cut at 80 characters.
- A sweep that is skipped prints one line.
- A row with no keyholder check has no keyholder value: it is never
  `keyholderDown`, and it is not among the keyholders up.
- A certificate with no number in `daysLeft` counts as no certificate.
- A registry hash that is not known is not compared, as with the commits.
  With no usual commit or no usual hash, nothing is compared.

The network's view:

- Two tails still tied after "the higher position" stand at the same
  position; the record hash that sorts first is taken.
- A tie between two leaders goes to the lower id. A voter that names no
  leader is not counted.
- A tie between two usual commits, or two usual hashes, goes to the text
  that sorts first.
- Quiet is false in the sweep after one that had no tail: a sweep that
  reached nobody, or one with no voters.

The states and the two-sweep rule:

- A sweep that is not judged leaves the waiting states as they are. So the
  two sweeps that agree may have a sweep that reached nobody between them.
- After a start the keyholder value is taken from the first judged sweep
  at once: it has no history row to start from.
- The old row's `ended_at` is the new row's `started_at`, the time of the
  first of the two sweeps.
- The wording of the detail lines is the table in section 6.3.
- A validator that names no leader, at the network's tail while the
  network is quiet and names one, is out of step.

The history and the log:

- A validator's first state prints no log line. Only a change does. So
  the first start on a new server prints its start lines and one sweep
  line, not 25 more.
- "One an hour" is the first sweep of every clock hour, UTC.
- In `sweeps`, `counted` and `keyholders_up` are the numbers on top as
  they stood after that sweep. `position` and `leader` are null too for a
  sweep with no voters.
- A second row with the same `swept_at` is dropped, not an error.

The software line:

- The three `git ls-remote` calls run at once. A read that works prints
  nothing.
- `softwareLine()` and `githubMains()` in `server/software/github.js`, and
  most of what `newestSweep()` holds, are there for the overview of step
  2. Nothing reads them yet.

The app:

- Any path but `/api/health` gets Express's own 404 for now.
- `lastSweepAt` is the start of the newest sweep, also when that sweep
  reached nobody.

### Step 2 (2026-11-17)

The checks:

- `decodeBase64Url` came over from the masterpod's file with the two
  checks: a sign-in finds its passkey by the assertion's id, which
  arrives as base64url. The two PRF helpers did not come.
- The library's reason for a refused passkey can quote what the request
  carried. It goes to the log on one line, cut at 200 characters.
- A new passkey's credential id must be 16 to 1023 bytes, what WebAuthn
  allows. The masterpod's own routes check a new passkey the same way.
  Another length is `passkey verification failed`. The `passkeys` table
  has no such check.

The challenges:

- A challenge is used the first time a request brings it, also when that
  request is then refused: because the challenge was handed out for
  another purpose, or by the passkey check. A request that is refused for
  its shape or its label before the challenge is looked at does not use
  it.
- The challenges past their five minutes are forgotten when the next one
  is handed out. They have no clock of their own.
- The user handle is kept with an `add` challenge too. Nothing reads it
  there.

The session:

- The SHA-256 is taken over the 32 bytes, not over their base64url text.
- `expires_at` is now plus `SESSION_DAYS` times 86400 seconds, the same
  number as the cookie's `Max-Age`.
- The `Set-Cookie` line is written by hand, with the attributes of
  section 9.3 and no others. Express's own helper would add `Expires`.
- When a request carries more than one cookie named `monitor_session`,
  the first counts. A value that is not 43 base64url characters is no
  session, and the database is not asked.
- Each request that needs the session reads `sessions` once. No session
  is kept in memory.
- Signing in while signed in starts one more session. The row before it
  stays until its time, or its own sign-out.
- The hourly delete logs a failure and goes on, as a read of the registry
  does. It prints nothing when it works.

The routes:

- The answers where the plan names none: `create` 201
  `{ "signedIn": true }`; `sign-in` `{ "signedIn": true }`; `add` 201
  `{ "id" }`; the list `{ "passkeys": [...] }`, oldest first, the mark
  called `thisSession`; a removal `{ "removed": true }`; `sign-out`
  `{ "signedIn": false }`; the history `{ "history": [...] }`.
- The statuses and phrases of the refusals where the plan names none are
  the table in section 9.4. `unknown or expired challenge` and
  `passkey verification failed` are the masterpod's, with its status 401.
- "Is there an owner" is "is there a passkey" for `create`, for `signIn`
  and in `GET /api/session`, never "is there an `owner` row". Only the
  `add` challenge reads the `owner` row, for its handle. A missing row
  there, which only a hand in psql can cause, is 409 `no owner yet`.
- The `exclude` of a `create` challenge is always empty, and the table is
  not read for it. So a `create` challenge never carries a passkey's id
  to a stranger, also when the owner's passkey is made in the same
  moment.
- The transaction of `create` that only one request at a time can be in
  begins with `LOCK TABLE passkeys IN EXCLUSIVE MODE`. A removal begins
  the same way, so two removals at once cannot empty the list between
  them.
- The `owner` row is written with `ON CONFLICT ... DO UPDATE`. After the
  list was emptied on the server, the row from before is still there. It
  takes the new handle and a new `created_at`.
- `create` leaves `last_used_at` null. Only a sign-in sets it.
- The two writes of a sign-in run in one transaction. A passkey that was
  removed between the check and the write is `unknown passkey`.
- `add` writes with `ON CONFLICT (credential_id) DO NOTHING`. A passkey
  that is in the list already is 409.
- `add` takes no lock. A request that was signed in the moment before
  `delete from passkeys` ran on the server can still write its passkey
  after it. The page then says "Sign in" where it should offer the
  owner's passkey, and the line is run once more.
- `create` and `add` check in this order: the shape, the label, the
  challenge, the registration.
- A label's length is counted in characters, as the database counts them.
  A label with a zero character in it is refused like one of the wrong
  length: the database cannot hold it. Nothing else is checked.
- The passkey a session signed in with can be removed, unless it is the
  last. That ends the session: the next request answers 401. The cookie
  is not cleared.
- A DELETE for an id that is not a number is 404 `unknown passkey`, like
  one for a number that is not in the list.
- The door logs one line when a passkey is made, added or removed, and at
  every sign-in. A sign-out logs nothing.

The app:

- The headers go on every answer, also on a refusal, a 404 and a 500.
- The Origin rule runs before the body is read. A request with no
  `Origin` header goes on.
- A path no route answers is 404 as JSON, also outside `/api`, until step
  3 hands out the build. Express's own 404 would put its own
  Content-Security-Policy in place of the one in section 9.6.
- An error is answered by the app's own handler, for the same reason. One
  that carries a status from 400 to 499 comes from reading the request (a
  body that is too long or is not JSON, a path that cannot be decoded),
  and is answered with that status and `bad request`. Anything else is
  500, with one log line that names the route and carries the error.
- The 64 KB and the headers sit in `server/app.js`, the challenges' five
  minutes and 200 in `server/auth/challenges.js`: each beside the one
  place that uses it, not in `server/config.js`.

The overview:

- Where nothing is known yet the answer keeps the plan's shape, with
  null: section 10 says where. `reachedNobody` and `stale` are false
  before the first sweep.
- After a start the shown states are in memory at once, but the overview
  reads the newest sweep, which is there when the first sweep has ended.
  So for the first seconds after a start no tile has a state.
- `address` is the registry row's address.
- An inactive row carries its `id` beside the two fields the plan names:
  the tile shows the number.
- The colours are not in the sweep's files.
  `server/overview/overview.routes.js` names the four red states, for the
  order of `problems`.
- The registry in use decides which rows there are and which are active.
  For up to a minute after a registry change, `network.active` can still
  be the count of the sweep before it.
- `software.readAt` is the oldest of the three reads from GitHub, so "not
  read since" holds for all three. It is null until all three have worked
  once.
- `same` under `registry` is false while the usual hash is not known, as
  `same` under `software` is while a commit is not.
- Hashes and GitHub's commits are whole. The page cuts them.
- The history does not look the id up in the registry. A validator that
  left the registry still has its history, and a number no validator ever
  had answers an empty list. An id that is not a whole number above 0,
  of nine digits at most, is 404 `unknown validator`.
- The history's read sits in `server/overview/overview.routes.js`, beside
  its route. `server/sweep/history.js` is as step 1 left it.

Other files:

- `server/index.js` starts the hourly delete of the sessions that are
  past their time, after the tables are made, and stops it at a shutdown.
- `README.md`: the paragraph that says how far the build is.
- `db/schema.sql`, `server/config.js` and the sweep's files are as step 1
  left them. No package was added.

### Step 3 (2026-11-17)

The packages:

- npm ran once, as `npm install --before=2026-10-27T05:39:46Z`. That is
  the moment the wallet's lock file was written. A plain install on
  2026-11-17 takes newer versions than the wallet holds: Angular 22.2.6,
  Material and CDK 22.2.7, the Angular CLI 22.2.7, prettier 3.10.1. With
  the date, npm took the wallet's versions for every package that
  `package.json` names. `package.json` carries the wallet's own version
  ranges.
- tslib is the one that differs: 2.9.1 here, 2.8.1 in the wallet's lock
  file. Step 1's lock file held 2.9.1 already, for the packages the
  passkey library brings along, and the page takes the same copy. No
  line of step 1's lock file moved: its 105 entries are as they were,
  `@simplewebauthn/server` 14.0.3 among them.
- The step added 347 entries to the lock file. Every one is a package
  the wallet's lock file holds too. 320 are at the wallet's version. 27
  are one patch newer: the 23 `@inquirer` packages the Angular CLI asks
  its questions with, and `browserslist`, `electron-to-chromium`,
  `postcss` and `sync-child-process`.
- npm ended with a notice that four packages (`esbuild`, `lmdb`,
  `msgpackr-extract`, `@parcel/watcher`) have install scripts "not yet
  covered by allowScripts". Nothing was approved and no setting was
  changed. The build runs.

The build's settings:

- `angular.json` is the wallet's with four changes: the project's name
  `monitor`; port 4210 for `ng serve`; the `optimization` value of
  section 9.6 in the production configuration; and no `assets` entry,
  because the monitor has no `public` folder.
- `"fonts": true` in that value makes the build read the two font style
  sheets from `fonts.googleapis.com` while it builds, and write them
  into `index.html`. So the machine that builds must reach that host; a
  build that cannot reach it ends with an error. The wallet's build
  does the same.
- The page has no icon: no `public` folder, no icon file, no icon link in
  `src/index.html`. A browser that asks for `/favicon.ico` gets the
  page's `index.html`, cannot use it, and shows its own blank icon.
- `tsconfig.json` and `tsconfig.app.json` are the wallet's, byte for
  byte. There is no `tsconfig.spec.json`: the monitor has no test files,
  and `angular.json` has no test target.
- `proxy.conf.json` is the wallet's with the port 4400. The target is
  `http://localhost:4400`, as the plan has it, and the server listens on
  127.0.0.1 only. Node tries both addresses of `localhost`, so the two
  meet.
- No `.editorconfig`, no `.prettierrc` and no `.vscode` folder: the
  plan's layout names none.
- `src/material-theme.scss` and `src/main.ts` are the wallet's, byte for
  byte. `src/index.html` is the wallet's with the monitor's title and
  without the icon link. `src/styles.css` has the wallet's rules for the
  page, for `code` and for the class `danger`, and the four colours.
- Each of the four colours is a fill, the ink that is read on it, and a
  line around it: green `#e6f4ea`, `#0d652d`, `#81c995`; amber
  `#fef7e0`, `#7a4f01`, `#f2b600`; red `#fce8e6`, `#a50e0e`, `#ee675c`;
  grey `#f1f3f4`, `#5f6368`, `#bdc1c6`.
- The title in `src/index.html` is the one sentence that is not in
  `src/app/words.ts`: the browser shows it before the page's scripts
  run. The same words stand in `words.ts` for everything after that.
- Two files under `src/app/pages/overview/` are not in the plan's
  layout, which names the folder: `validator-details.component.*`, the
  card of section 11.5, and `parts.component.ts`, which sets a commit, a
  hash or a command in the code font inside a line.

The shell and the routes:

- The bar is the shell's (`src/app/app.html`), not the overview's own,
  so the passkeys page has it too. It shows only while the browser is
  signed in; the sign-in page has no bar and carries the title itself.
- The menu is a Material menu behind a button with three dots. The title
  in the bar is a link to the overview.
- Whether the browser is signed in is kept in the API service
  (`signedIn`): what the server last said, in `GET /api/session`, after
  a sign-in, after a sign-out, and with a 401 `not signed in`.
- The browser's tab reads "Validator monitor" on the sign-in page and
  the overview, and "Passkeys" on the passkeys page.
- Any path the page does not know leads to the overview.
- The guard takes a server that does not answer as not signed in. The
  sign-in page then says that the server does not answer.
- The plan says that any answer 401 sends the page to `/sign-in`. Step 2
  gave three more refusals the status 401: a challenge that is used or
  too old, a passkey the server does not know, a passkey it does not
  accept. Those happen on the sign-in page and while a passkey is added,
  to a browser that may well be signed in. So only the 401
  `not signed in` sends the page to `/sign-in`; the others show their
  line.
- "Sign out" goes to `/sign-in` whatever the server answered. The
  sign-in page asks `GET /api/session` anew, so it shows what is true.
  When the server does not answer the sign-out, the browser is still
  signed in: the session and its cookie are still there. The sign-in
  page then says that the server does not answer, and the bar stays on
  top. "Sign out" is pressed again once the server answers.
- While the guard waits for `GET /api/session`, the page is empty. On a
  link that takes long, that can last up to the call's 20 seconds.

The calls:

- Every call gets 20 seconds. Past them it counts as not answered. So a
  screen that is left open says that the server does not answer, and
  does not wait for ever.
- The lines for the refusals are the table in section 11.3. A refusal
  whose phrase the page does not know shows its HTTP status. A status
  from 502 up reads as a server that does not answer: that is what nginx
  says when the server behind it is down.

The passkey calls:

- `requireResidentKey: true` stands beside `residentKey: 'required'`, as
  in the wallet's file. It is the same wish in the older browsers' word.
- The wallet's two return types went with PRF. Both calls return the
  credential's JSON alone.
- The three names the device shows on its own sheet (`anos monitor`,
  `owner`, `Monitor owner`) and the label `Owner` are in `words.ts`.
- The wallet takes `hexToBytes` from `@noble/hashes`, which the monitor
  does not hold. `hexToBytes` and `base64UrlToBytes` are written by hand
  at the end of the file. A text that is not hex, or not base64url,
  stops the call with a line.
- A browser that has no passkeys on the page's address gets a line that
  says so: a page that is not on https or on `localhost`, or an old
  browser.
- The passkey call's own failures are told apart by the error's name:
  `NotAllowedError`, `InvalidStateError`, and anything else with the
  browser's own message (section 11.3).

The sign-in page:

- Until `GET /api/session` has answered, the page shows the title and a
  moving bar, and no button.
- When the server does not answer, the button says "Try again" and asks
  `GET /api/session` once more.
- A browser that is signed in already goes on to the overview.
- After a refusal 409 the page asks `GET /api/session` again, so the
  button says what is true.
- The failure's line stands between the button and the note.
- The two buttons that use a passkey carry the fingerprint icon, as the
  wallet's does. "Try again" carries none.
- The plan does not say what happens when a sign-in goes through and the
  overview does not open. The guard would send the page to `/sign-in`,
  where it is already, and nothing would show. So the page asks
  `GET /api/session` once more and says why (section 11.3). The likely
  reason is a browser that does not keep the session's cookie.
- On the operator's own machine the wallet's relying-party id is
  `localhost` too. So the device's sheet can offer the wallet's test
  passkeys beside the monitor's. One of those is refused with "This
  passkey is not one of the owner's."
- A passkey the device made and the server then refused stays on the
  device. The page does not say so. It can happen when two people make
  the owner's passkey in the same moment.

The overview:

- The plan names three lines that stand in place of the problem line.
  They are tried in the plan's order: no registry, reached nobody, stale.
- The plan gives those lines no colour. "No registry read yet." and "The
  first sweep is running." are grey: nothing is wrong, there is nothing
  to show yet. The other two are red: what the screen shows is old.
- The plan has no sentence for the seconds between a start and the end
  of the first sweep. It is "The first sweep is running."
- The plan does not say what the page does when its own ask fails. The
  screen stays as it was, and the line turns red: the failure's line,
  then "This screen is from 18:26:10 UTC.", the time of the last answer.
  After a 401 `not signed in` the line says so for the moment the page
  takes to reach `/sign-in`.
- "and 2 more" is a sentence of its own in the line: "And 2 more."
- A third sentence for the state `certificate`: "Validator N: its
  certificate needs a look." It stands when the doorman did not answer
  the newest sweep while the screen still shows the state. The days are
  the newest sweep's, and that sweep has none.
- A card whose number is not known shows a dash. "Floor is 13" is left
  out while the floor is not known.
- Five tiles in a row from 840 pixels up, four from 600, three under
  600. The four cards stand two in a row under 600 pixels.
- A row no sweep has judged yet has a grey tile that says a dash. A
  state's key the page does not know shows as the key itself, on a grey
  tile.
- The first tile is chosen at the first answer that carries a sweep, not
  at the first answer: before it no state is known. A tap before that
  counts. "Validator 1" is the first registry row.
- When the tapped row has left the registry, the page chooses again by
  the same rule.
- The software line. "All 25" stands only when every active validator
  runs the three usual commits; else the line reads "most run". When
  GitHub was not read, the first sentence stays and the plan's sentence
  follows it. The plan's sentence stands alone when no commit is known.
- The server has no rule for when GitHub's read is too old, and the page
  does not know `GITHUB_MINUTES`. The page's rule: not read when
  `software.readAt` is null or more than 30 minutes old. That is three
  times `GITHUB_MINUTES` at its value of 10, as `stale` is three times
  `SWEEP_SECONDS`. The number stands in
  `src/app/pages/overview/overview.page.ts`. A change of the setting
  does not change it.
- While `software.readAt` is null the sentence is "GitHub was not read
  yet.", since there is no time to name.
- "GitHub main is newer" is said for a program whose `same` is false, as
  the plan has it. `same` is false too when the validators run a commit
  that is not on GitHub main at all.
- The registry line's second sentence is left out while no validator's
  hash is known.
- A time that is not on today's UTC day carries its day, and one of
  another year its year. The plan's examples are all of today.
- Under an hour a time span is in minutes, and under a minute it reads
  "less than a minute". The plan has hours under two days, then days.
  So a validator that was just started reads "3 minutes".
- "Today", "2 hours" and the 30 minutes are counted on the browser's
  clock, at the newest ask. A browser whose clock is off shows them off
  by as much.
- The sweep's `tookMs` and each row's keyholder answer time are in the
  answer and are not shown.

The details:

- The help line stands under the state, in the state's row.
- A registry row that is not active shows "Not active" with no time, and
  a dash in every other row but Earlier.
- "Answer time" shows the short reason when port 3000 gave no answer.
  The plan puts `reason` into the overview and names no row for it.
- "Registry" shows two hashes: the registry the doorman read, with its
  count of active rows, and the one the validator applied. The state
  `otherRegistry` looks at both.
- "Certificate" reads "no certificate" when the doorman answered and has
  none, and a dash when the doorman did not answer.
- "Database answer" and "Answer time" are whole milliseconds. The days of
  a certificate carry one decimal at most.
- "Keyholder" leaves out what is not known. Up or Down is what the
  screen shows; with one bad answer the row can read "Up" alone.
- "Earlier" is the route's list as it is, so its first entry is the
  state the validator is in now.
- The history is read when a tile is tapped and when the tapped
  validator's state or its start has changed, not with every ask. A
  read that fails is tried again with the next ask.

The passkeys page:

- "Remove" asks in the row itself, with "Yes, remove" and "Keep". There
  is no pop-up box.
- "Add a passkey" opens a text box on the page, with "Make the passkey"
  and "Cancel". The Enter key in the box does what "Make the passkey"
  does. The box takes 40 characters at most.
- The question before the passkey this browser signed in with is removed
  adds that the browser will be signed out. After the removal the next
  call is refused with 401, and the page goes to `/sign-in`.
- The page has the shell's bar, and its own link back to the overview.
- A passkey that has not signed in reads "not used since", behind
  "Added ...". Making the owner's passkey signs the browser in and sets
  no time of use (Notes, Step 2), so right after it the owner's row has
  the mark "This browser signed in with it" and reads "not used since".
- The page reads its list when it opens and after each change, not on a
  clock. When that read fails, its line stays until the page is loaded
  again.

The server:

- `server/app.js` hands out the build as `web_app/server/app.js` does:
  the 404 for `/api` first, then the files, then `index.html` for any
  other GET or HEAD. Two things differ. A request with another method
  goes on to the app's own 404, which was there already. And
  `index.html` is sent by its name inside the build's folder, not by its
  whole path, so a folder on the way whose name starts with a dot does
  not turn the page into a 404.
- The build's files go out with Express's own cache line,
  `public, max-age=0`: the browser asks each time whether its copy is
  still the newest. The wallet's do the same.

Other files:

- `README.md`: "Running it on this machine" has `ng serve` and
  `http://localhost:4210`, as the plan has them, and three things more:
  what the page offers the first time; that the device may offer the
  wallet's test passkeys for `localhost` too; and `npm run build` with
  `http://localhost:4400`, the one address where the page runs under the
  server's headers.
- `docs/schemas.md`: section 11, and the lines of sections 1, 7, 9.4,
  9.5, 9.6 and 10 that spoke of the page as still to come.
- `db/schema.sql`, `server/config.js`, `server/index.js` and every other
  file under `server/` are as step 2 left them.
