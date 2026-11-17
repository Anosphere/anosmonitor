# monitor: the record

The settings, the tables, the states and the rules of the monitor, and at
the end the notes: every choice the build made where the plan is silent.

Built from `~/Desktop/Z-TestNet/forclaude/monitor-plan-1.md` (FINAL,
2026-11-17), in that plan's four steps. Sections 1 to 7 carry the plan's
own numbers, so "section 6.3" means the same here and there.

**Step 1, the project and the sweep, 2026-11-17.** The folder, the
packages, the settings, the tables, the registry, the sweep, the newest
commits on GitHub, and `GET /api/health`. After this step the server
sweeps and logs, and nothing shows the result yet. Checked with
`node --check` on every file under `server/`, and with nothing else: the
server was not started and no database was made. The first start is the
test.

## 1. The project

A small server of its own asks every doorman's public `/health` once a
minute and keeps what it learns. It only looks: no key to any validator,
no button that changes anything outside the monitor.

The files so far:

```text
monitorsoftware/
  README.md  LICENSE  .gitignore
  package.json  package-lock.json
  db/schema.sql                       the tables
  server/
    index.js                          the start: settings, schema, registry, sweeps, listen
    config.js                         the settings, each with a local default
    app.js                            the Express app: GET /api/health
    db/pool.js  db/schema.js          the pool; applying db/schema.sql at the start
    registry/registry.js              reading, checking, hashing and keeping the registry
    sweep/ask.js                      one GET with the time limit and the size limit
    sweep/sweep.js                    one sweep: asking everyone; the clock; the newest sweep in memory
    sweep/network.js                  the network's view
    sweep/states.js                   one validator's state; the two-sweep rule
    sweep/history.js                  the two history tables and their log lines
    software/github.js                the newest commits on GitHub main
  docs/schemas.md                     this file
```

`package.json`: name `monitor`, private, `"type": "module"`, license
Apache-2.0, the wallet's three scripts (`start` = `ng serve`, `build` =
`ng build`, `server` = `node server/index.js`). The packages so far are
the server's four, at the versions the other projects hold: `express`
5.3.0 (the wallet's), `pg` 8.23.1, `canonicalize` 5.1.0 and
`@simplewebauthn/server` 14.0.3 (the masterpod's).

The start (`server/index.js`), in order: the settings; `db/schema.sql`
applied; the registry (the kept copy, then GitHub); the newest commits on
GitHub; the sweeps; the listen on `PORT`, on 127.0.0.1. It prints where
it listens, the origins, the relying-party id, the database, the registry
address, the sweep's two numbers and the build folder. A database that
cannot be reached stops the start with one line.

`GET /api/health`, open to anyone:
`{ "status": "ok", "lastSweepAt": <time or null> }`. `lastSweepAt` is
when the newest sweep started, null before the first.

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

`owner`, `passkeys` and `sessions` are made now and first used by the
door (step 2). The passkey challenges are not a table; they will live in
the server's memory.

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

The page's sentences will be built from, for each of the three programs:
the usual commit, how many run it, GitHub's newest commit or null, and
whether the two are the same (`softwareLine(usual)`).

During a pull round this line and the amber "Other software" tiles are the
tick sheet: the tiles turn as each banker pulls.

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
