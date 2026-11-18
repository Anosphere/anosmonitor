import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { ApiService, PasskeyItem } from '../../services/api.service';
import { PasskeyService } from '../../services/passkey.service';
import { dated, words } from '../../words';

/** One passkey as the list shows it. */
interface Line {
  id: number;
  label: string;
  /** "Added 17 Nov 2026 14:02 UTC, last used 17 Nov 2026 18:20 UTC", or "Added 17 Nov 2026 14:02 UTC, not used since". */
  when: string;
  thisSession: boolean;
  /** The question its "Remove" asks. */
  question: string;
}

/**
 * The passkeys page (docs/schemas.md section 11.6): the owner's passkeys,
 * one more added, one removed.
 *
 * The list shows each passkey's label, when it was added, when it was last
 * used, and a mark on the one this browser signed in with.
 *
 * "Add a passkey" asks for a label and runs the passkey call. The label is
 * checked here, before the call: 1 to 40 characters after trimming. A
 * label the server refused afterwards would leave a passkey on the device
 * that the server never wrote down. Every press asks for a new challenge.
 *
 * "Remove" asks once, in the row itself, before it removes. The last
 * passkey has no "Remove". Removing the passkey this browser signed in
 * with ends its session: the next call is refused with 401, and the page
 * goes to /sign-in.
 */
@Component({
  selector: 'app-passkeys-page',
  imports: [FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, MatProgressBarModule, RouterLink],
  templateUrl: './passkeys.page.html',
  styleUrl: './passkeys.page.css',
})
export class PasskeysPage {
  private readonly api = inject(ApiService);
  private readonly passkey = inject(PasskeyService);
  protected readonly w = words;

  /** The list, oldest first; null until it is read. */
  protected readonly lines = signal<Line[] | null>(null);

  /** True from a press of a button until what it started has ended. */
  protected readonly busy = signal(false);

  /** The one line under the list, or null. */
  protected readonly failure = signal<string | null>(null);

  /** The id of the passkey whose "Remove" was pressed and waits for its yes; null when none does. */
  protected readonly asked = signal<number | null>(null);

  /** True while the label of a new passkey is asked for. */
  protected readonly adding = signal(false);

  /** What the label's text box holds. */
  protected readonly label = signal('');

  constructor() {
    void this.read();
  }

  /** Reads the list: when the page opens, and after a passkey was added or removed. A refusal shows its line; after a 401 `not signed in` the page is on its way to /sign-in as well (the API service does that). */
  private async read(): Promise<void> {
    const answer = await this.api.passkeys();
    if (!answer.ok) {
      this.failure.set(words.failure(answer.status, answer.phrase));
      return;
    }
    this.lines.set(answer.body.passkeys.map(lineOf));
  }

  /** "Add a passkey": the label's text box opens. */
  protected startAdding(): void {
    this.failure.set(null);
    this.asked.set(null);
    this.label.set('');
    this.adding.set(true);
  }

  /** "Cancel": the text box closes, and nothing was made. */
  protected stopAdding(): void {
    this.failure.set(null);
    this.adding.set(false);
  }

  /** "Make the passkey": the label is checked, then a challenge, the passkey call, and the server writes the passkey down. */
  protected async add(): Promise<void> {
    if (this.busy()) return;
    const label = this.label().trim();
    const length = Array.from(label).length;
    if (length < 1 || length > 40) {
      this.failure.set(words.passkeys.badLabel);
      return;
    }
    this.busy.set(true);
    this.failure.set(null);
    try {
      const challenge = await this.api.newPasskeyChallenge('add');
      if (!challenge.ok) {
        this.failure.set(words.failure(challenge.status, challenge.phrase));
        return;
      }
      const { challenge: hex, rpId, userHandle, exclude } = challenge.body;

      let passkey: Record<string, unknown>;
      try {
        passkey = await this.passkey.register(hex, rpId, userHandle, exclude);
      } catch (err) {
        this.failure.set(words.passkeyFailure(err));
        return;
      }

      const added = await this.api.addPasskey(hex, passkey, label);
      if (!added.ok) {
        this.failure.set(words.failure(added.status, added.phrase));
        return;
      }
      this.adding.set(false);
      await this.read();
    } finally {
      this.busy.set(false);
    }
  }

  /** "Remove": the row asks once. */
  protected ask(id: number): void {
    this.failure.set(null);
    this.adding.set(false);
    this.asked.set(id);
  }

  /** "Yes, remove": the server removes the passkey and its sessions, and the list is read again. */
  protected async remove(id: number): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.failure.set(null);
    this.asked.set(null);
    try {
      const removed = await this.api.removePasskey(id);
      if (!removed.ok) this.failure.set(words.failure(removed.status, removed.phrase));
      await this.read();
    } finally {
      this.busy.set(false);
    }
  }
}

/** One passkey of the server's list as the page shows it. */
function lineOf(item: PasskeyItem): Line {
  const t = words.passkeys;
  const used = item.lastUsedAt === null ? t.neverUsed : t.lastUsed(dated(item.lastUsedAt));
  return {
    id: item.id,
    label: item.label,
    when: `${t.added(dated(item.createdAt))}, ${used}`,
    thisSession: item.thisSession,
    question: t.askRemove(item.label, item.thisSession),
  };
}
