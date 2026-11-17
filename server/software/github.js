import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';

/**
 * The newest commits on GitHub main (docs/schemas.md section 7), for the
 * software line: the commit most validators run is compared with the
 * newest commit on main of the three repositories.
 *
 * At the start and every GITHUB_MINUTES: `git ls-remote <repo>
 * refs/heads/main` for the validator's, the doorman's and the keyholder's
 * repository, each with 15 seconds and with no prompt for a password. No
 * GitHub token: the three repositories are public. The 40 characters are
 * kept in memory with the time. A read that fails keeps the older value
 * and logs one line.
 *
 * A validator reports a short commit. It is "the newest on GitHub main"
 * when GitHub's 40 characters begin with it.
 */

const run = promisify(execFile);

/** The three programs and their repositories. */
const REPOS = Object.freeze({
  validator: config.validatorRepo,
  doorman: config.doormanRepo,
  keyholder: config.keyholderRepo,
});

/** For each program, GitHub main's newest commit as 40 hex characters and when it was read; both null until a read worked. */
const mains = {
  validator: { commit: null, readAt: null },
  doorman: { commit: null, readAt: null },
  keyholder: { commit: null, readAt: null },
};

let timer = null;

/** Why a git call failed, in one line. */
function reasonOf(err) {
  if (err.killed) return 'timeout';
  const stderr = typeof err.stderr === 'string' ? err.stderr.trim() : '';
  return (stderr || String(err.message)).split('\n')[0];
}

/** One program's read. A read that fails keeps the older value and logs one line. Never throws. */
async function readMain(program) {
  const repo = REPOS[program];
  try {
    const { stdout } = await run('git', ['ls-remote', repo, 'refs/heads/main'], {
      encoding: 'utf8',
      timeout: config.githubTimeoutMs,
      // No prompt for a password: git fails at once where it would ask.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const match = /^([0-9a-f]{40})\trefs\/heads\/main$/m.exec(stdout);
    if (match === null) throw new Error('the answer names no refs/heads/main');
    mains[program] = { commit: match[1], readAt: new Date() };
  } catch (err) {
    console.error(`GitHub main of the ${program} not read from ${repo}: ${reasonOf(err)}`);
  }
}

/** One read of all three, at once. */
function readMains() {
  return Promise.all(Object.keys(REPOS).map(readMain));
}

/** Starts the reads: once now, then every GITHUB_MINUTES. Starting twice does nothing. */
export function startGithub() {
  if (timer !== null) return;
  timer = setInterval(readMains, config.githubMinutes * 60_000);
  timer.unref();
  void readMains();
}

/** Stops the reads; one already under way finishes by itself. */
export function stopGithub() {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

/** GitHub main's newest commits: { validator, doorman, keyholder }, each { commit, readAt }, both null until a read worked. */
export function githubMains() {
  return mains;
}

/**
 * What the page's software line is built from, for each of the three
 * programs: the usual commit, how many run it, GitHub's newest commit or
 * null, and whether the two are the same. `usual` is the usual commits of
 * the newest sweep (server/sweep/network.js): { validator, doorman,
 * keyholder }, each { commit, running }; or null when that sweep was not
 * judged, and then no commit is known. Returns the same three keys, each
 * { commit, running, main, same }.
 */
export function softwareLine(usual) {
  const line = {};
  for (const program of Object.keys(REPOS)) {
    const { commit, running } = usual === null ? { commit: null, running: 0 } : usual[program];
    const main = mains[program].commit;
    line[program] = { commit, running, main, same: commit !== null && main !== null && main.startsWith(commit) };
  }
  return line;
}
