# monitor

A screen for the anos validators, behind the owner's passkey.

A small server asks every validator's doorman for its public health answer
once a minute, on port 3000 for the validator and on port 3200 for the
keyholder. From the answers it works out which validators run, which are
down, and which run other software than the rest, and it keeps a short
history in a small Postgres database. A website that only the owner's
passkey opens shows the result.

The monitor only looks. It reads what every doorman already answers to
anyone. It holds no key to any validator, and nothing in it changes
anything on one. The list of validators is the registry file the
validators themselves pull, read from GitHub; this repository holds no
copy of it and no validator address.

The plan it is built from is `forclaude/monitor-plan-1.md`, beside the
repositories. The record is `docs/schemas.md`: the settings, the tables,
the states and the rules.

So far the server sweeps, logs and answers the page, and the page shows
the result: the sign-in by passkey, the overview and the passkeys
(`docs/schemas.md`, sections 9 to 11). What is still to come is the
monitor's own server: its deploy files and the lines that set it up, with
the last step of the plan.

## Running it on this machine

Postgres runs on this machine and lets the logged-in user in without a
password. Node.js 24. Then, from this folder:

```bash
createdb monitor
```

```bash
npm install
```

```bash
npm run server
```

And in a second terminal, from this folder too:

```bash
ng serve
```

Then <http://localhost:4210>. The passkey made there is one for
`localhost`, apart from the one for `monitor.anocloud.com`.

No env file is needed: every setting has a local default
(`server/config.js`). The server makes its own tables at every start
(`db/schema.sql`). It reads the real registry from GitHub and sweeps the
real network. Those are the same public reads as on the monitor's own
server.

`ng serve` shows the page on port 4210 and builds it anew at every change
of a file. It hands every path under `/api` to the server on port 4400
(`proxy.conf.json`).

The first time, the page offers one button, "Make the owner's passkey".
The first passkey made is the owner's. From then on the page says "Sign
in", and the overview follows. At a sign-in the device may offer other
passkeys for `localhost` too, the wallet's test passkeys among them. The
monitor takes only its own.

The first terminal shows where the server listens, then the registry it
took, then the first sweep:

```text
monitor listening on http://localhost:4400
  origins    http://localhost:4210, http://localhost:4400
  rp id      localhost
  database   monitor at 127.0.0.1:5432
  registry   https://raw.githubusercontent.com/Anosphere/anosvalidator/main/network/testnet.registry.json
  sweep      every 60 s, 10 s for each answer
  build      dist/monitor/browser
registry 1076ef27d932d8b3, 25 active, read from GitHub
sweep 18:25:40Z: 25 of 25 counted, 25 keyholders up, position 639, leader 22, 912 ms
```

After that it prints one line when a validator's state changes
(`validator 24: good -> notCounted`) and one sweep line an hour. A change
shows after two sweeps in a row have seen it, so within two minutes. A
read from GitHub that fails prints one line; one that works prints
nothing.

<http://localhost:4400/api/health> answers
`{"status":"ok","lastSweepAt":"..."}`.

The state each validator is in now, from the history table:

```bash
psql monitor -c 'select validator_id, state, detail, started_at from validator_states where ended_at is null order by validator_id'
```

The server hands out the built page too, as it will on the monitor's own
server. This line builds the page into `dist/monitor/browser`:

```bash
npm run build
```

Then <http://localhost:4400> shows the same page with no `ng serve`. Only
there does the page run under the server's safety headers
(`docs/schemas.md`, section 9.6); `ng serve` sets none. The passkey for
`localhost` opens both addresses. The name must be `localhost`: at
`127.0.0.1` the server refuses the sign-in.
