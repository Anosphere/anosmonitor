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

The server sweeps, logs and answers the page, and the page shows the
result: the sign-in by passkey, the overview and the passkeys
(`docs/schemas.md`, sections 9 to 11). The files that put the monitor on
its own server, and the lines that set that server up, are under "The
monitor server" below (`docs/schemas.md`, section 12).

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

The server hands out the built page too, as it does on the monitor's own
server. This line builds the page into `dist/monitor/browser`:

```bash
npm run build
```

Then <http://localhost:4400> shows the same page with no `ng serve`. Only
there does the page run under the server's safety headers
(`docs/schemas.md`, section 9.6); `ng serve` sets none. The passkey for
`localhost` opens both addresses. The name must be `localhost`: at
`127.0.0.1` the server refuses the sign-in.

## The monitor server

The monitor is made for a server of its own at Hetzner, monitor1, with
the name `monitor.anocloud.com`. The server is set up like the wallet
servers: Ubuntu 26.04, SSH by key only, ufw, nginx and Node.js 24.
Postgres runs on the same server, and no balancer stands in front. On
the server:

- The code is the clone of this repository at
  `/opt/monitor/monitorsoftware`, owned by the system user `monitor`,
  whose home is `/opt/monitor`. The page is built there with
  `npx ng build`; `dist/` stays out of git.
- The settings are the committed file `network/monitor.env`. Nothing in
  it is secret. No `.env` exists on the server, and no secret besides
  the certificate's key.
- The monitor signs in to Postgres as the local user `monitor` over the
  local socket, with no password.
- One unit, `deploy/monitor.service`. It runs
  `node --env-file=network/monitor.env server/index.js` as the user
  `monitor`, with the wallet unit's limits.
- nginx ends TLS for `https://monitor.anocloud.com` with the site
  `deploy/nginx/monitor.conf` and the certificate at `/etc/monitor/tls`,
  and hands everything to the server on `127.0.0.1:4400`. Any other name
  on port 443 gets no answer. nginx limits `/api/` to five requests a
  second for each address, with a burst of 20, and adds the
  `Strict-Transport-Security` header. The page's other safety headers
  are the server's own.
- Port 80, the site `deploy/nginx/monitor-acme.conf`, serves only the
  Let's Encrypt challenge folder, `/var/www/acme`, and sends everything
  else to https.
- The certificate comes from Let's Encrypt over port 80, with acme.sh on
  the server itself, so no deSEC token sits on the server. A daily job
  renews the certificate and reloads nginx.
- `scripts/install-system-files.sh`, run as root, puts these in place
  (the TLS folder, the challenge folder, the two nginx sites, the unit)
  and restarts the unit. It runs twice at the set-up, before and after
  the certificate, and again after every pull.

The set-up is twelve steps, from a new server to the owner's passkey.
The operator runs every line and reads what it prints before the next
one. Nothing runs against monitor1 from a chat. The lines go into an SSH
session as root on monitor1, opened on the computer that holds the key
for the Hetzner servers. No line holds a dollar sign. The steps carry
the numbers of the plan's section 13: step 9 here is 13.9 there.

Before the first line, three things must be there:

- This repository, with all four steps of the plan, is on GitHub `main`
  of `https://github.com/Anosphere/anosmonitor.git`.
- In the Hetzner console: a new server named `monitor1`, Ubuntu 26.04,
  the same type as wallet1, with the SSH key and with IPv4 and IPv6.
  Note its two addresses.
- At deSEC: an A record and an AAAA record for `monitor` in
  `anocloud.com`, to those two addresses. They must answer before step
  9, because Let's Encrypt looks the name up.

Step 1. Look first. Prints the name, the public address, whether a
restart is due, whether passwords are allowed, `Status: inactive`, the
CPU count and the memory.

```text
hostname; ip -4 -br addr show eth0; ls /var/run/reboot-required 2>&1; grep -rh -E '^PasswordAuthentication' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/; ufw status | sed -n 1p; nproc; free -m | sed -n 2p
```

Step 2. The name, the updates, the restart. The session ends by itself.
Wait half a minute and log in again.

```text
hostnamectl set-hostname monitor1 && echo 'preserve_hostname: true' > /etc/cloud/cloud.cfg.d/99-hostname.cfg && apt-get update && NEEDRESTART_MODE=a DEBIAN_FRONTEND=noninteractive apt-get -o Dpkg::Options::=--force-confold full-upgrade -y && apt-get autoremove -y && hostname && reboot
```

Step 3. SSH by key only. Keep this session open and prove the key from a
second terminal before closing it. Prints `passwordauthentication no`,
`kbdinteractiveauthentication no`, `permitrootlogin prohibit-password`.

```text
tee /etc/ssh/sshd_config.d/10-key-only.conf >/dev/null <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t && systemctl reload ssh && sshd -T | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) '
```

Step 4. ufw: 22, 80 and 443 from anywhere. Prints `Status: active` and
the six rules.

```text
ufw default deny incoming && ufw default allow outgoing && ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable && ufw status numbered
```

Step 5. Node.js 24, the version wallet1 holds, held. Prints `v24.22.2`
and `nodejs` as the held package. If apt says the version was not found,
`apt-cache madison nodejs | head -3` shows what there is; take the
newest 24.

```text
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource-setup.sh && bash /tmp/nodesource-setup.sh && apt-get install -y nodejs=24.22.2-1nodesource1 && apt-mark hold nodejs && node -v && apt-mark showhold
```

Step 6. Postgres, the user, the database. The last word printed is
`monitor`: the user `monitor` reaches its database with no password.

```text
apt-get install -y postgresql && useradd --system --create-home --home-dir /opt/monitor --shell /bin/bash monitor && chmod 755 /opt/monitor && sudo -u postgres createuser monitor && sudo -u postgres createdb -O monitor monitor && sudo -iu monitor psql -d monitor -Atc 'select current_user'
```

Step 7. The clone, its packages and the build. A few minutes. Prints the
commit on `main`, then Angular's summary and the files of
`dist/monitor/browser`: `index.html`, one `main-<hash>.js` and one
`styles-<hash>.css`. The build reads two font style sheets from
`fonts.googleapis.com`, so monitor1 must reach that host here and at
every later build; a build that cannot reach it ends with an error.
`npm ci` may end with a notice about four packages whose install scripts
are not approved. Nothing needs approving: the build runs without them.

```text
sudo -iu monitor bash -c 'git clone https://github.com/Anosphere/anosmonitor.git /opt/monitor/monitorsoftware && cd /opt/monitor/monitorsoftware && npm ci && git log --oneline -1 && npx ng build 2>&1 | tail -15 && ls dist/monitor/browser'
```

Step 8. nginx and the install script's first pass: the port 80 site and
the unit; the TLS site is skipped until the certificate is there. The
script says `TLS site skipped` and ends with
`Next: the certificate into /etc/monitor/tls`. Then the monitor's own
lines: where it listens, the registry line with
`1076ef27d932d8b3, 25 active` or what the registry is by then, the first
sweep's line, and `{"status":"ok",...}`.

```text
apt-get install -y nginx && nginx -v && cd /opt/monitor/monitorsoftware && sh scripts/install-system-files.sh && sleep 5 && journalctl -u monitor -n 15 --no-pager -o cat && curl -s http://127.0.0.1:4400/api/health; echo
```

What the line ends with on monitor1, after systemd's own line that the
unit started. The registry's and the sweep's numbers are those of that
moment:

```text
monitor listening on http://localhost:4400
  origins    https://monitor.anocloud.com
  rp id      monitor.anocloud.com
  database   monitor at /var/run/postgresql
  registry   https://raw.githubusercontent.com/Anosphere/anosvalidator/main/network/testnet.registry.json
  sweep      every 60 s, 10 s for each answer
  build      dist/monitor/browser
registry 1076ef27d932d8b3, 25 active, read from GitHub
sweep 18:25:40Z: 25 of 25 counted, 25 keyholders up, position 639, leader 22, 912 ms
{"status":"ok","lastSweepAt":"..."}
```

A validator that does not answer holds a sweep for up to ten seconds.
Then the sweep's line is not there yet, and the last line reads
`{"status":"ok","lastSweepAt":null}`.

Step 9. The certificate, with acme.sh as on the wallet servers, over
port 80. Five lines, one after the other; put your email in the second.
The fourth prints `Cert success`.

```text
git clone --depth 1 --branch 3.1.6 https://github.com/acmesh-official/acme.sh.git /root/acme.sh-src
cd /root/acme.sh-src && ./acme.sh --install -m <your email>
/root/.acme.sh/acme.sh --set-default-ca --server letsencrypt
/root/.acme.sh/acme.sh --issue --server letsencrypt -d monitor.anocloud.com -w /var/www/acme
/root/.acme.sh/acme.sh --install-cert -d monitor.anocloud.com --ecc --key-file /etc/monitor/tls/key.pem --fullchain-file /etc/monitor/tls/fullchain.pem --reloadcmd "chmod 600 /etc/monitor/tls/key.pem && systemctl reload nginx"
```

acme.sh puts a daily job into root's crontab. It renews the certificate
and reloads nginx by itself.

Step 10. The install script's second pass: the TLS site. The script now
says `nginx site monitor (installed)`. Prints the two sites in
`sites-enabled` and the listeners on 443 and 80.

```text
cd /opt/monitor/monitorsoftware && sh scripts/install-system-files.sh && ls -l /etc/nginx/sites-enabled && ss -ltn | grep -E ':(443|80) '
```

Step 11. The site, asked on the server itself. Prints
`{"status":"ok",...}` and `{"owner":false,"signedIn":false}`.

```text
curl -s --resolve monitor.anocloud.com:443:127.0.0.1 https://monitor.anocloud.com/api/health; echo; curl -s --resolve monitor.anocloud.com:443:127.0.0.1 https://monitor.anocloud.com/api/session; echo
```

Step 12. The owner's passkey, at once. Open
`https://monitor.anocloud.com` on the device that should hold the
passkey and press "Make the owner's passkey". The screen follows. From
this moment nobody else can make one.

If the page says "Sign in" instead, before you ever made a passkey,
someone else was first. "Later, on the server" has the line that starts
over.

## Later, on the server

These lines too go into an SSH session as root on monitor1.

Updating, the same two lines as the wallet's. The first pulls. The
second builds the page and runs the install script, which restarts the
unit. It ends with `active` and `{"status":"ok",...}`; `lastSweepAt` is
`null` there while the first sweep after the restart is still running.

```text
sudo -iu monitor git -C /opt/monitor/monitorsoftware pull --ff-only
```

```text
sudo -iu monitor bash -c 'cd /opt/monitor/monitorsoftware && npx ng build 2>&1 | tail -3 && ls dist/monitor/browser' && sh /opt/monitor/monitorsoftware/scripts/install-system-files.sh && sleep 3 && systemctl is-active monitor && curl -s http://127.0.0.1:4400/api/health; echo
```

When the pull names `package-lock.json`, this line goes between the two:

```text
sudo -iu monitor bash -c 'cd /opt/monitor/monitorsoftware && npm ci'
```

A pull that changed `db/schema.sql` needs nothing more: the server
applies it when it starts.

If every passkey is lost, or a stranger made the first one: this line
empties the list and ends every session. The page then offers "Make the
owner's passkey" again.

```text
sudo -iu monitor psql -d monitor -c 'delete from passkeys'
```

Nothing on monitor1 is backed up. The history is a convenience, and a
passkey can be made again.
