import { Component, computed, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { Doorman, HistoryRow, Keyholder, Validator, Worker } from '../../services/api.service';
import { day, lasting, minute, words } from '../../words';
import { PartsComponent } from './parts.component';

/** One row of the card: a label and its value. */
interface Row {
  label: string;
  value: string;
}

/** One entry of the Earlier list: the state with its times, and the detail line, which may be empty. */
interface Entry {
  line: string;
  detail: string;
}

/**
 * The details of the tapped tile (docs/schemas.md section 11.5): a card
 * under the tiles, a label and a value in each row.
 *
 * The state and its time are what the screen shows (the two-sweep rule);
 * the other rows are the newest sweep's fields. A value that is not known
 * shows a dash: a field the answer did not carry, the validator's rows
 * when the doorman answered alone, every row but the state when port 3000
 * gave no answer, and every row of a registry row that is not active.
 *
 * The help line shows only for "Not counted". The last row, Earlier, is
 * the validator's last ten states with their times, which the overview
 * page reads from /api/validators/:id/history.
 *
 * Every value is what a validator answered, or a line the monitor's server
 * made from it, and is shown as text, never as HTML.
 */
@Component({
  selector: 'app-validator-details',
  imports: [MatCardModule, PartsComponent],
  templateUrl: './validator-details.component.html',
  styleUrl: './validator-details.component.css',
})
export class ValidatorDetailsComponent {
  /** The tapped validator's entry of the overview. */
  readonly validator = input.required<Validator>();

  /** The browser's clock at the newest ask, in milliseconds: what "2 hours" and "today" are counted from. */
  readonly now = input.required<number>();

  /** The validator's last ten states, newest first; null while they are not read. */
  readonly history = input.required<HistoryRow[] | null>();

  protected readonly w = words;

  /** The State row: what the tile says, then "since 14:02 UTC, 2 hours". */
  protected readonly state = computed(() => {
    const { state, since } = this.validator();
    if (state === null) return words.dash;
    const says = words.state(state);
    if (since === null || since === undefined) return says;
    const now = this.now();
    return words.details.since(says, minute(since, now), lasting((now - Date.parse(since)) / 1000));
  });

  /** The rows between the state and Earlier, in the order of section 11.5. */
  protected readonly rows = computed<Row[]>(() => {
    const validator = this.validator();
    const doorman = validator.doorman ?? null;
    const worker = validator.worker ?? null;
    const keyholder = validator.keyholder ?? null;
    const t = words.details;
    const dash = words.dash;
    return [
      { label: t.position, value: worker === null || worker.position === null ? dash : t.positionValue(worker.position, worker.recordHash) },
      { label: t.leader, value: worker === null || worker.leader === null ? dash : String(worker.leader) },
      { label: t.counted, value: worker === null || worker.counted === null ? dash : worker.counted ? t.yes : t.no },
      { label: t.ignores, value: worker === null || worker.ignored === null ? dash : worker.ignored.length === 0 ? t.nobody : worker.ignored.join(', ') },
      { label: t.validatorRunning, value: worker === null || worker.uptimeSeconds === null ? dash : lasting(worker.uptimeSeconds) },
      { label: t.database, value: worker === null || worker.dbMs === null ? dash : t.ms(worker.dbMs) },
      { label: t.doormanRunning, value: doorman === null || doorman.uptimeSeconds === null ? dash : lasting(doorman.uptimeSeconds) },
      { label: t.certificate, value: certificateOf(doorman) },
      { label: t.answer, value: answerOf(validator) },
      { label: t.software, value: softwareOf(doorman, worker, keyholder) },
      { label: t.registry, value: registryOf(doorman, worker) },
      { label: t.keyholder, value: keyholderOf(validator, keyholder) },
      { label: t.address, value: validator.address ?? dash },
    ];
  });

  /** The Earlier list; empty while the history is not read, and for a validator that has none. */
  protected readonly earlier = computed<Entry[]>(() => {
    const now = this.now();
    return (this.history() ?? []).map((row) => {
      const says = words.state(row.state);
      const from = minute(row.startedAt, now);
      return {
        line: row.endedAt === null ? words.details.earlierNow(says, from) : words.details.earlierPast(says, from, minute(row.endedAt, now)),
        detail: row.detail,
      };
    });
  });
}

/** The Certificate row: the days left and the day it ends. "no certificate" when the doorman answered and has none. */
function certificateOf(doorman: Doorman | null): string {
  if (doorman === null) return words.dash;
  if (doorman.certificateDaysLeft === null) return words.details.noCertificate;
  const ends = doorman.certificateNotAfter === null ? null : day(doorman.certificateNotAfter);
  return words.details.certificateValue(doorman.certificateDaysLeft, ends);
}

/** The Answer time row: the milliseconds port 3000 took, or the short reason when it gave no answer. */
function answerOf(validator: Validator): string {
  if (typeof validator.answerMs === 'number') return words.details.ms(validator.answerMs);
  if (typeof validator.reason === 'string') return words.details.noAnswer(validator.reason);
  return words.dash;
}

/** The Software row: the three commits. A dash for the whole row when none is known. */
function softwareOf(doorman: Doorman | null, worker: Worker | null, keyholder: Keyholder | null): string {
  const commits = [worker?.commit ?? null, doorman?.commit ?? null, keyholder?.commit ?? null] as const;
  if (commits.every((commit) => commit === null)) return words.dash;
  return words.details.softwareValue(...commits);
}

/** The Registry row: the registry the doorman read, with its count of active rows, and the one the validator applied. A dash for the whole row when neither is known. */
function registryOf(doorman: Doorman | null, worker: Worker | null): string {
  const read = doorman?.registryHash ?? null;
  const applied = worker?.registryHash ?? null;
  if (read === null && applied === null) return words.dash;
  return words.details.registryValue(read, doorman?.registryActive ?? null, applied);
}

/**
 * The Keyholder row: Up or Down, running for, shares waiting. Up or Down
 * is what the screen shows, by the two-sweep rule; the other two are the
 * newest sweep's. A dash for a row with no keyholder check.
 */
function keyholderOf(validator: Validator, keyholder: Keyholder | null): string {
  const t = words.details;
  const said: string[] = [];
  if (typeof validator.keyholderUp === 'boolean') said.push(validator.keyholderUp ? t.up : t.down);
  if (keyholder !== null && keyholder.uptimeSeconds !== null) said.push(t.runningFor(lasting(keyholder.uptimeSeconds)));
  if (keyholder !== null && keyholder.copiesWaiting !== null) said.push(t.sharesWaiting(keyholder.copiesWaiting));
  return said.length === 0 ? words.dash : said.join(', ');
}
