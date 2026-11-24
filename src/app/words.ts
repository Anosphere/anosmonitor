/**
 * Every sentence the page shows (docs/schemas.md section 11), in English
 * only. One group for each part of the page. The pages work out what is the
 * case and take the sentence for it from here; nothing in this file asks
 * the server. A sentence with a number, a time or a name in it is a
 * function.
 *
 * Every time is in UTC, as the servers' logs are. What is not known shows a
 * dash.
 */

/** One piece of a line: plain words, or a commit, a hash or a command, which the page sets in the code font. */
export interface Part {
  text: string;
  code?: boolean;
}

/** What stands where a value is not known. */
const DASH = '–';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function two(n: number): string {
  return String(n).padStart(2, '0');
}

/** "1 day", "2 days". */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** "15 Nov", and with `year` "15 Nov 2026": a day, in UTC. */
function dayOf(date: Date, year: boolean): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}${year ? ` ${date.getUTCFullYear()}` : ''}`;
}

/** "18:25:40 UTC", and without `seconds` "18:25 UTC": a time of day, in UTC. */
function timeOf(date: Date, seconds: boolean): string {
  return `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}${seconds ? `:${two(date.getUTCSeconds())}` : ''} UTC`;
}

/**
 * A moment as the screen shows it. One on today's UTC day shows its time
 * alone, "18:25 UTC". One on another day carries the day in front,
 * "15 Nov 18:25 UTC", and one of another year the year too. `iso` is the
 * server's ISO text, `now` the browser's clock in milliseconds. A text that
 * is no date shows a dash.
 */
function moment(iso: string, now: number, seconds: boolean): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return DASH;
  const today = new Date(now);
  const sameYear = date.getUTCFullYear() === today.getUTCFullYear();
  if (sameYear && date.getUTCMonth() === today.getUTCMonth() && date.getUTCDate() === today.getUTCDate()) {
    return timeOf(date, seconds);
  }
  return `${dayOf(date, !sameYear)} ${timeOf(date, seconds)}`;
}

/** "18:25:40 UTC": the time of a sweep, with its seconds. */
export function clock(iso: string, now: number): string {
  return moment(iso, now, true);
}

/** "14:02 UTC": when a state began, when GitHub was read. */
export function minute(iso: string, now: number): string {
  return moment(iso, now, false);
}

/** "17 Nov 2026 14:02 UTC": a moment with its day and its year always, for the list of passkeys. */
export function dated(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? DASH : `${dayOf(date, true)} ${timeOf(date, false)}`;
}

/** "22 Nov": the day a certificate ends. */
export function day(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? DASH : dayOf(date, false);
}

/**
 * "2 hours": how long something has lasted, from its seconds. Minutes under
 * an hour, hours under two days, then days, each a whole number, rounded
 * down.
 */
export function lasting(seconds: number): string {
  if (!Number.isFinite(seconds)) return DASH;
  if (seconds < 60) return 'less than a minute';
  if (seconds < 3_600) return count(Math.floor(seconds / 60), 'minute');
  if (seconds < 172_800) return count(Math.floor(seconds / 3_600), 'hour');
  return count(Math.floor(seconds / 86_400), 'day');
}

/** "1.4 days": the days a certificate has left, with one decimal at most. */
function daysOf(days: number): string {
  return count(Math.round(days * 10) / 10, 'day');
}

/** A commit as the screen shows it: its first 7 characters, in the code font. One that is not known shows a dash. */
function commit(value: string | null): Part {
  return value === null ? { text: DASH } : { text: value.slice(0, 7), code: true };
}

/** A registry hash or a record hash as the screen shows it: its first 8 characters. */
function short(hash: string): string {
  return hash.slice(0, 8);
}

/** What a tile says for each state (docs/schemas.md section 6.3), by the state's key. `notActive` is a registry row with `active` false. */
const STATES: Record<string, string> = {
  noAnswer: 'No answer',
  validatorDown: 'Validator down',
  databaseDown: 'Database down',
  notCounted: 'Not counted',
  votedOut: 'Voted out',
  outOfStep: 'Out of step',
  certificate: 'Certificate',
  otherSoftware: 'Other software',
  otherRegistry: 'Other registry',
  keyholderDown: 'Keyholder down',
  good: 'Counted',
  notActive: 'Not active',
};

/** The problem line's sentence for each state that is a problem, by the state's key. `n` is the validator's id; `days` is what its certificate has left, "1.4 days", null when it has none, and undefined when the newest sweep does not say. */
const PROBLEMS: Record<string, (n: number, days: string | null | undefined) => string> = {
  noAnswer: (n) => `Validator ${n} does not answer.`,
  validatorDown: (n) => `Validator ${n}: the doorman answers, the validator behind it does not.`,
  databaseDown: (n) => `Validator ${n}: its database does not answer.`,
  notCounted: (n) => `Validator ${n} answers but is not counted.`,
  votedOut: (n) => `Validator ${n} is voted out by the others.`,
  outOfStep: (n) => `Validator ${n} is out of step with the others.`,
  certificate: (n, days) =>
    days === undefined
      ? `Validator ${n}: its certificate needs a look.`
      : days === null
        ? `Validator ${n} has no certificate.`
        : `Validator ${n}: its certificate ends in ${days}.`,
  otherSoftware: (n) => `Validator ${n} runs other software than most.`,
  otherRegistry: (n) => `Validator ${n} has another registry than most.`,
  keyholderDown: (n) => `Validator ${n}: its keyholder does not answer.`,
};

/** What a tile of our own servers says for each state (docs/schemas.md section 18.2), by the state's key. */
const OWN_STATES: Record<string, string> = {
  answers: 'Answers',
  running: 'Running',
  noAnswer: 'No answer',
  databaseDown: 'Database down',
  closedPage: 'Closed page',
  otherAnswer: 'Other answer',
  notAsked: 'Not asked',
};

/** The problem line's sentence for each state of our own servers that is a problem, by the state's key. `who` is what the sentence calls the server; `seen` is the detail in brackets with a space in front, " (timeout)", or empty. */
const OWN_PROBLEMS: Record<string, (who: string, seen: string) => string> = {
  noAnswer: (who, seen) => `${who} does not answer${seen}.`,
  databaseDown: (who, seen) => `${who} answers, its database does not${seen}.`,
  closedPage: (who) => `${who} shows the wallet's closed page.`,
  otherAnswer: (who, seen) => `${who} gives another answer than the monitor expects${seen}.`,
};

/** The line for each refusal of the server (docs/schemas.md section 9.4), by the server's own short phrase. */
const REFUSALS: Record<string, string> = {
  'not signed in': 'You are not signed in any more.',
  'unknown or expired challenge': 'That took too long. Press the button again.',
  'unknown passkey': "This passkey is not one of the owner's.",
  'passkey verification failed': 'The server did not accept this passkey.',
  'origin not allowed': 'The server takes no requests from this address.',
  'the owner exists already': "The owner's passkey exists already. Sign in with it.",
  'no owner yet': "The server holds no passkey. The first one made is the owner's.",
  'this passkey is in the list already': 'This passkey is in the list already.',
  'the last passkey stays': 'The last passkey stays.',
  'the label must be 1 to 40 characters': 'A label has 1 to 40 characters.',
};

/** The name of an error, as a passkey call throws it: "NotAllowedError". Empty for anything that carries none. */
function nameOf(err: unknown): string {
  return typeof err === 'object' && err !== null && 'name' in err && typeof err.name === 'string' ? err.name : '';
}

/** The message of an error, or the thing itself as a text. */
function messageOf(err: unknown): string {
  return typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string' ? err.message : String(err);
}

export const words = {
  /** The title: on the sign-in page, in the bar, and on the browser's tab. */
  title: 'Validator monitor',

  /** What stands where a value is not known. */
  dash: DASH,

  /** The bar on top of every page behind the sign-in. */
  shell: {
    menu: 'Menu',
    passkeys: 'Passkeys',
    signOut: 'Sign out',
  },

  /** The sign-in page (section 11.3). */
  signIn: {
    make: "Make the owner's passkey",
    makeNote: "The first passkey made here is the owner's. After that, this page only signs in.",
    signIn: 'Sign in',
    again: 'Try again',
    /** The server took the passkey and started the session, and the next request came without it. */
    notKept: "The sign-in went through, but this browser did not keep it. It has to accept the monitor's cookie.",
  },

  /** What the passkey calls hand to the device, which shows them on its own sheet (section 11.2), and what the passkey service says when a call cannot be made. The last three are read behind "The passkey did not work: ". */
  passkey: {
    rpName: 'anos monitor',
    userName: 'owner',
    displayName: 'Monitor owner',
    /** The label the first passkey is sent with (section 9.4). */
    ownerLabel: 'Owner',
    noCredential: 'the browser returned no public-key credential',
    noPasskeys: 'this browser cannot use a passkey on this address',
    unreadable: 'the answer of the server cannot be read',
  },

  /**
   * The one line for a call the server refused or did not answer. `status`
   * is the HTTP status, 0 when nothing came back; `phrase` is the server's
   * own short phrase, or empty when it sent none.
   */
  failure(status: number, phrase: string): string {
    if (status === 0 || status >= 502) return "The monitor's server does not answer.";
    if (status === 404 && phrase === 'unknown passkey') return 'That passkey is not in the list any more.';
    if (Object.hasOwn(REFUSALS, phrase)) return REFUSALS[phrase];
    return `The monitor's server answered with an error (HTTP ${status}).`;
  },

  /**
   * The one line for a passkey call the device or the browser did not
   * finish. `err` is what the call threw: the browser's own error, by its
   * name, or one of the passkey service's.
   */
  passkeyFailure(err: unknown): string {
    const name = nameOf(err);
    if (name === 'NotAllowedError') return 'No passkey was used. Press the button to try again.';
    if (name === 'InvalidStateError') return "This device holds one of the owner's passkeys already.";
    return `The passkey did not work: ${messageOf(err)}`;
  },

  /** What a tile says for a state (section 6.3). A key this file does not know shows as it is. */
  state(key: string): string {
    return Object.hasOwn(STATES, key) ? STATES[key] : key;
  },

  /**
   * The problem line's sentence for one validator (section 11.4). `days` is
   * the days its certificate has left, null when it has none, and undefined
   * when the newest sweep does not say; only the state `certificate` reads
   * it. A key this file does not know shows as it is.
   */
  problem(key: string, n: number, days: number | null | undefined): string {
    if (!Object.hasOwn(PROBLEMS, key)) return `Validator ${n}: ${key}.`;
    return PROBLEMS[key](n, typeof days === 'number' ? daysOf(days) : days);
  },

  /** The overview (section 11.4): the four cards, and the line under them. */
  overview: {
    counted: 'Validators counted',
    keyholders: 'Keyholders up',
    position: 'Chain position',
    leader: 'Leader',
    of: (n: number, all: number) => `${n} of ${all}`,
    floor: (n: number) => `Floor is ${n}`,
    noProblems: (swept: string) => `No problems. Last sweep ${swept}.`,
    more: (n: number) => `And ${n} more.`,
    lastSweep: (swept: string) => `Last sweep ${swept}.`,
    noRegistry: 'No registry read yet.',
    firstSweep: 'The first sweep is running.',
    reachedNobody: 'The monitor reached no validator in its last sweep. Its own connection may be down.',
    stale: (swept: string) => `The monitor has not swept since ${swept}.`,
    /** Behind the line of an ask the server did not answer: the time of the last answer, which is what the screen still shows. */
    screenFrom: (at: string) => `This screen is from ${at}.`,
    tiles: 'The validators',
  },

  /** Our own servers (section 18.5): the heading over their tiles, what a tile says, and the problem line's sentence. */
  own: {
    title: 'Our own servers',
    /** What a tile says for a state (section 18.2). A key this file does not know shows as it is. */
    state(key: string): string {
      return Object.hasOwn(OWN_STATES, key) ? OWN_STATES[key] : key;
    },
    /**
     * The problem line's sentence for one of our own servers. The masterpod
     * is called "The masterpod", a wallet name by its host name in full, and
     * anything else by the name on its tile. `detail` is the short line that
     * goes with the state; it stands in brackets when it is not empty. A key
     * this file does not know shows as it is.
     */
    problem(key: string, kind: string, name: string, address: string | null, detail: string): string {
      const who = kind === 'masterpod' ? 'The masterpod' : kind === 'wallet' && address !== null ? address.replace(/^[a-z]+:\/\//, '') : name;
      const seen = detail === '' ? '' : ` (${detail})`;
      return Object.hasOwn(OWN_PROBLEMS, key) ? OWN_PROBLEMS[key](who, seen) : `${who}: ${key}${seen}.`;
    },
  },

  /** The software line (section 11.4), in pieces: the page puts them together. */
  software: {
    /** "Software: all 25 run validator 6b27427, doorman 4cfade2 and keyholder 6d4b89c", with no full stop. `all` is the count of the active validators when every one of them runs the three usual commits, null when only most do. */
    runs: (all: number | null, validator: string | null, doorman: string | null, keyholder: string | null): Part[] => [
      { text: `Software: ${all === null ? 'most' : `all ${all}`} run validator ` },
      commit(validator),
      { text: ', doorman ' },
      commit(doorman),
      { text: ' and keyholder ' },
      commit(keyholder),
    ],
    /** The end of that sentence when all three are the newest on GitHub main. */
    newest: ', the newest on GitHub main.',
    /** The end of that sentence in every other case. */
    stop: '.',
    /** " GitHub main is newer for the validator: 1a2b3c4." The program's name is the word the sentence uses. */
    newer: (program: 'validator' | 'doorman' | 'keyholder', main: string): Part[] => [
      { text: ` GitHub main is newer for the ${program}: ` },
      commit(main),
      { text: '.' },
    ],
    /** GitHub could not be read. `since` is the time of the last read, null when there was none yet. */
    notRead: (since: string | null) => (since === null ? ' GitHub was not read yet.' : ` GitHub was not read since ${since}.`),
    /** No commit is known at all, and there is nothing to say about GitHub. */
    unknown: `Software: ${DASH}`,
  },

  /**
   * The versions line (section 19.4), in pieces: which version of the
   * validator's code runs on how many validators. "Validator versions: v3
   * on 1 (validator 1), v2 on 20, v1 on 4 (validators 5, 9, 11, 23)."
   */
  versions: {
    lead: 'Validator versions: ',
    /** What a group is called: its version's name, "v3", or the commit in the code font when it has no version tag. */
    name: (version: string | null, value: string): Part => (version === null ? commit(value) : { text: version }),
    /** " on 4": how many validators run it. */
    on: (n: number) => ` on ${n}`,
    /** " (validator 1)", " (validators 5, 9, 11, 23)": which ones, for every group but the one most validators are in. */
    who: (ids: number[]) => ` (${ids.length === 1 ? 'validator' : 'validators'} ${ids.join(', ')})`,
    /** "all 25 run ": in front of the name when every active validator runs the same. */
    all: (n: number) => `all ${n} run `,
    between: ', ',
    stop: '.',
    /** No validator's commit is known. */
    unknown: `Validator versions: ${DASH}`,
  },

  /** The registry line (section 11.4), in pieces. */
  registry: {
    rows: (active: number) => `Registry: ${count(active, 'active row')}.`,
    applied: (hash: string): Part[] => [
      { text: ' The validators applied the registry on GitHub main (' },
      { text: short(hash), code: true },
      { text: ').' },
    ],
    differs: (main: string, usual: string): Part[] => [
      { text: " GitHub main's registry (" },
      { text: short(main), code: true },
      { text: ') is not the one most validators applied (' },
      { text: short(usual), code: true },
      { text: ').' },
    ],
    unknown: `Registry: ${DASH}`,
  },

  /** The details of one validator (section 11.5): the labels, and the values that are more than a number. */
  details: {
    title: (id: number) => `Validator ${id}`,
    state: 'State',
    /** "Not counted since 14:02 UTC, 2 hours". */
    since: (says: string, at: string, long: string) => `${says} since ${at}, ${long}`,
    /** The help line, only for "Not counted". */
    help: [
      { text: 'If it stays this way for some minutes, the banker restarts the program on the worker: ' },
      { text: 'sudo systemctl restart anos-validator', code: true },
      { text: ". While it stands at the network's chain position and is not counted, nothing can land." },
    ] as Part[],
    position: 'Chain position',
    /** "639 (5efff567)": the position and the first 8 characters of the record hash. */
    positionValue: (position: number, recordHash: string | null) => (recordHash === null ? `${position}` : `${position} (${short(recordHash)})`),
    leader: 'Leader it names',
    counted: 'Counted',
    yes: 'yes',
    no: 'no',
    ignores: 'Ignores',
    nobody: 'nobody',
    validatorRunning: 'Validator running for',
    database: 'Database answer',
    doormanRunning: 'Doorman running for',
    certificate: 'Certificate',
    /** "4.5 days left, ends 22 Nov". `ends` is the day it ends, null when the doorman did not say. */
    certificateValue: (days: number, ends: string | null) => (ends === null ? `${daysOf(days)} left` : `${daysOf(days)} left, ends ${ends}`),
    noCertificate: 'no certificate',
    answer: 'Answer time',
    /** Port 3000 gave no answer: the short reason in place of the time. */
    noAnswer: (reason: string) => `no answer: ${reason}`,
    ms: (n: number) => `${Math.round(n)} ms`,
    software: 'Software',
    /** "validator v1 (6b27427), doorman 4cfade2, keyholder 6d4b89c": the three commits, each cut at 7 characters. `version` is the name of the version the validator's commit is, which stands in front of it; null when it has no version tag, and then the commit stands alone. */
    softwareValue: (validator: string | null, doorman: string | null, keyholder: string | null, version: string | null) =>
      `validator ${validator === null ? DASH : version === null ? validator.slice(0, 7) : `${version} (${validator.slice(0, 7)})`}, doorman ${doorman?.slice(0, 7) ?? DASH}, keyholder ${keyholder?.slice(0, 7) ?? DASH}`,
    registry: 'Registry',
    /** "doorman 1076ef27, 25 active; validator 1076ef27": the registry the doorman read, with its count of active rows, and the one the validator applied. */
    registryValue: (doorman: string | null, active: number | null, validator: string | null) =>
      `doorman ${doorman === null ? DASH : short(doorman)}${active === null ? '' : `, ${active} active`}; validator ${validator === null ? DASH : short(validator)}`,
    keyholder: 'Keyholder',
    up: 'Up',
    down: 'Down',
    runningFor: (long: string) => `running for ${long}`,
    sharesWaiting: (n: number) => `${count(n, 'share')} waiting`,
    address: 'Address',
    earlier: 'Earlier',
    /** One entry of the Earlier list: the state the validator is in now. */
    earlierNow: (says: string, from: string) => `${says} since ${from}`,
    /** One entry of the Earlier list: a state that ended. */
    earlierPast: (says: string, from: string, to: string) => `${says}, ${from} to ${to}`,
  },

  /** The passkeys page (section 11.6). */
  passkeys: {
    title: 'Passkeys',
    back: 'Back to the overview',
    thisBrowser: 'This browser signed in with it',
    added: (at: string) => `Added ${at}`,
    lastUsed: (at: string) => `last used ${at}`,
    /** No sign-in with it since it was added. Read behind "Added ...": making the owner's passkey signs the browser in and counts as no use. */
    neverUsed: 'not used since',
    remove: 'Remove',
    /** The question before a passkey is removed. `thisBrowser` is true for the one this browser signed in with. */
    askRemove: (label: string, thisBrowser: boolean) =>
      thisBrowser ? `Remove "${label}"? This browser signed in with it and will be signed out.` : `Remove "${label}"?`,
    yesRemove: 'Yes, remove',
    keep: 'Keep',
    add: 'Add a passkey',
    label: 'Label',
    labelHint: 'A name for the device that will hold it, 1 to 40 characters.',
    makeIt: 'Make the passkey',
    cancel: 'Cancel',
    badLabel: 'A label has 1 to 40 characters.',
  },
};
