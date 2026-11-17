-- db/schema.sql
--
-- The monitor's tables (docs/schemas.md section 3). The server applies this
-- file itself at every start (server/db/schema.js), before anything else
-- uses the database, so a pull never needs a schema step by hand.
--
-- Every statement is safe to repeat: tables and indexes use IF NOT EXISTS,
-- comments just overwrite. A later change to a table is written as
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS, so it is safe to repeat too.
--
-- Comments live in the database itself and show up in psql with \d+ <table>.


-- ---------------------------------------------------------------------------
-- owner: the owner of the monitor, one row at most.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS owner (
  only_row   BOOLEAN     PRIMARY KEY DEFAULT true CHECK (only_row),
  handle     BYTEA       NOT NULL CHECK (octet_length(handle) = 16),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  owner            IS 'One row at most: the owner of the monitor, written with the first passkey.';
COMMENT ON COLUMN owner.only_row   IS 'Always true. As the primary key it keeps the table to one row.';
COMMENT ON COLUMN owner.handle     IS '16 random bytes: the user handle every passkey of the owner carries, so a phone lists them as one account.';
COMMENT ON COLUMN owner.created_at IS 'When the row was written.';


-- ---------------------------------------------------------------------------
-- passkeys: the passkeys that open the monitor.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS passkeys (
  id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  credential_id BYTEA       NOT NULL UNIQUE,
  public_key    BYTEA       NOT NULL,
  label         TEXT        NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ
);

COMMENT ON TABLE  passkeys               IS 'The allowed passkeys, all of them the owner''s. Signing in needs one of them.';
COMMENT ON COLUMN passkeys.id            IS 'The row''s number, given by the database.';
COMMENT ON COLUMN passkeys.credential_id IS 'The passkey''s WebAuthn credential id, raw bytes, as the passkey check returns it. A sign-in finds the row by it.';
COMMENT ON COLUMN passkeys.public_key    IS 'The passkey''s COSE public key, as the passkey check returns it.';
COMMENT ON COLUMN passkeys.label         IS 'The name the owner gave the passkey, 1 to 40 characters. The first passkey is called Owner.';
COMMENT ON COLUMN passkeys.created_at    IS 'When the passkey was added.';
COMMENT ON COLUMN passkeys.last_used_at  IS 'When the passkey last signed in. Null until it has.';


-- ---------------------------------------------------------------------------
-- sessions: one row for each sign-in.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sessions (
  token_hash BYTEA       PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  passkey_id BIGINT      NOT NULL REFERENCES passkeys (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE  sessions            IS 'One row for each sign-in. A request is signed in when the hash of its cookie is a row whose expires_at is ahead.';
COMMENT ON COLUMN sessions.token_hash IS 'The SHA-256 of the cookie''s value, 32 raw bytes. The value itself is not stored.';
COMMENT ON COLUMN sessions.passkey_id IS 'The passkey that signed in. Removing a passkey removes its sessions.';
COMMENT ON COLUMN sessions.created_at IS 'When the sign-in happened.';
COMMENT ON COLUMN sessions.expires_at IS 'The sign-in plus SESSION_DAYS. A row that is past it no longer signs in, and is deleted.';


-- ---------------------------------------------------------------------------
-- registry_copy: the last registry read from GitHub, one row at most.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS registry_copy (
  only_row   BOOLEAN     PRIMARY KEY DEFAULT true CHECK (only_row),
  body       JSONB       NOT NULL,
  hash       TEXT        NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  fetched_at TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE  registry_copy            IS 'One row at most: the last registry read from GitHub that passed the checks. The monitor starts from it, so it can sweep while GitHub cannot be read.';
COMMENT ON COLUMN registry_copy.only_row   IS 'Always true. As the primary key it keeps the table to one row.';
COMMENT ON COLUMN registry_copy.body       IS 'The registry as it was checked: { firstLeader, validators: [{ id, publicKey, url, active }] }.';
COMMENT ON COLUMN registry_copy.hash       IS 'The registry hash by the validators'' own rule, 64 lowercase hex characters: the SHA-256 of the canonical JSON of the rows ordered by id.';
COMMENT ON COLUMN registry_copy.fetched_at IS 'When this registry was last read from GitHub.';


-- ---------------------------------------------------------------------------
-- validator_states: the history of each validator's state.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS validator_states (
  id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  validator_id INTEGER     NOT NULL,
  state        TEXT        NOT NULL,
  detail       TEXT        NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL,
  ended_at     TIMESTAMPTZ
);
-- At most one open row for each validator: the state it is in now.
CREATE UNIQUE INDEX IF NOT EXISTS validator_states_open
  ON validator_states (validator_id) WHERE ended_at IS NULL;
-- One validator's rows, newest first: the history list.
CREATE INDEX IF NOT EXISTS validator_states_by_validator
  ON validator_states (validator_id, started_at DESC);

COMMENT ON TABLE  validator_states              IS 'One row for each stretch of time a validator spent in a state. The row with ended_at null is the state it is in now.';
COMMENT ON COLUMN validator_states.id           IS 'The row''s number, given by the database.';
COMMENT ON COLUMN validator_states.validator_id IS 'The validator''s id in the registry.';
COMMENT ON COLUMN validator_states.state        IS 'The state''s key: noAnswer, validatorDown, databaseDown, notCounted, votedOut, outOfStep, certificate, otherSoftware, otherRegistry, keyholderDown or good.';
COMMENT ON COLUMN validator_states.detail       IS 'One short line about the moment the state began, for the history list. It may be empty.';
COMMENT ON COLUMN validator_states.started_at   IS 'When the state began: the time of the first of the two sweeps that worked it out.';
COMMENT ON COLUMN validator_states.ended_at     IS 'When the next state began, or when the registry row turned inactive. Null while this is the state the validator is in.';


-- ---------------------------------------------------------------------------
-- sweeps: one row of numbers for each sweep.
-- ---------------------------------------------------------------------------

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

COMMENT ON TABLE  sweeps               IS 'One row for each sweep: its numbers. The answers themselves are not stored.';
COMMENT ON COLUMN sweeps.swept_at      IS 'When the sweep started.';
COMMENT ON COLUMN sweeps.took_ms       IS 'How long the asking took, in milliseconds.';
COMMENT ON COLUMN sweeps.active        IS 'How many active rows the registry had.';
COMMENT ON COLUMN sweeps.reached       IS 'How many validators answered on port 3000.';
COMMENT ON COLUMN sweeps.counted       IS 'The validators counted after this sweep. Null for a sweep that reached nobody.';
COMMENT ON COLUMN sweeps.keyholders_up IS 'The keyholders shown as up after this sweep. Null for a sweep that reached nobody.';
COMMENT ON COLUMN sweeps.position      IS 'The network''s chain position in this sweep. Null when there was none, and for a sweep that reached nobody.';
COMMENT ON COLUMN sweeps.leader        IS 'The id of the network''s leader in this sweep. Null when there was none, and for a sweep that reached nobody.';
