import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router } from '@angular/router';
import { ApiService, Refusal } from '../../services/api.service';
import { PasskeyService } from '../../services/passkey.service';
import { words } from '../../words';

/**
 * The sign-in page (docs/schemas.md section 11.3): the title and one
 * button.
 *
 * While the server holds no passkey, the button says "Make the owner's
 * passkey", and the first passkey made is the owner's. From then on it
 * says "Sign in", and the page only signs in. Which of the two it is comes
 * from GET /api/session. A browser that is signed in already goes on to the
 * overview. While the server does not answer, the button says "Try again"
 * and asks once more.
 *
 * Every press asks for a new challenge: the server uses a challenge the
 * first time a request brings it. A failure shows one line under the
 * button. After a sign-in the page goes to the overview; when the overview
 * does not open, the page says why.
 */
@Component({
  selector: 'app-sign-in-page',
  imports: [MatCardModule, MatButtonModule, MatIconModule, MatProgressBarModule],
  templateUrl: './sign-in.page.html',
  styleUrl: './sign-in.page.css',
})
export class SignInPage {
  private readonly api = inject(ApiService);
  private readonly passkey = inject(PasskeyService);
  private readonly router = inject(Router);
  protected readonly w = words;

  /**
   * What the server said about the door: `none` while it holds no passkey,
   * `owner` when it holds one, `unknown` when it did not answer. Null until
   * the first answer.
   */
  protected readonly door = signal<'none' | 'owner' | 'unknown' | null>(null);

  /** True from a press of the button until what it started has ended. */
  protected readonly busy = signal(false);

  /** The one line under the button, or null. */
  protected readonly failure = signal<string | null>(null);

  /** What the button says. */
  protected readonly button = computed(() => {
    const door = this.door();
    return door === 'none' ? words.signIn.make : door === 'owner' ? words.signIn.signIn : words.signIn.again;
  });

  constructor() {
    void this.look();
  }

  /**
   * Asks the server whether there is an owner and whether this browser is
   * signed in. Signed in: on to the overview. No answer: its line, and the
   * button asks again. Should the overview not open though the server said
   * signed in, the page stays and shows its button, so it never stands
   * with nothing to press.
   */
  private async look(): Promise<void> {
    const session = await this.api.session();
    if (!session.ok) {
      this.door.set('unknown');
      this.failure.set(words.failure(session.status, session.phrase));
      return;
    }
    if (session.body.signedIn) {
      await this.router.navigateByUrl('/');
      if (!this.stillHere()) return;
    }
    this.door.set(session.body.owner ? 'owner' : 'none');
  }

  /** The button. */
  protected async press(): Promise<void> {
    const door = this.door();
    if (door === null || this.busy()) return;
    this.busy.set(true);
    this.failure.set(null);
    try {
      if (door === 'none') await this.make();
      else if (door === 'owner') await this.signIn();
      else await this.look();
    } finally {
      this.busy.set(false);
    }
  }

  /** Makes the owner's passkey: a challenge, the passkey call, then the server writes the passkey down and starts the session. */
  private async make(): Promise<void> {
    const challenge = await this.api.newPasskeyChallenge('create');
    if (!challenge.ok) return this.refused(challenge);
    const { challenge: hex, rpId, userHandle, exclude } = challenge.body;

    let passkey: Record<string, unknown>;
    try {
      passkey = await this.passkey.register(hex, rpId, userHandle, exclude);
    } catch (err) {
      this.failure.set(words.passkeyFailure(err));
      return;
    }

    const created = await this.api.createOwner(hex, passkey, words.passkey.ownerLabel);
    if (!created.ok) return this.refused(created);
    await this.enter();
  }

  /** Signs in: a challenge, the passkey call, then the server checks the assertion and starts the session. */
  private async signIn(): Promise<void> {
    const challenge = await this.api.signInChallenge();
    if (!challenge.ok) return this.refused(challenge);

    let assertion: Record<string, unknown>;
    try {
      assertion = await this.passkey.assert(challenge.body.challenge, challenge.body.rpId);
    } catch (err) {
      this.failure.set(words.passkeyFailure(err));
      return;
    }

    const signedIn = await this.api.signIn(challenge.body.challenge, assertion);
    if (!signedIn.ok) return this.refused(signedIn);
    await this.enter();
  }

  /**
   * After a sign-in: on to the overview. The guard in front of it asks the
   * server once more whether this browser is signed in. When it does not
   * find the session, the page is still here, and a press of the button
   * would end here again with nothing said. So the page looks again and
   * says why: the server did not answer, or it answered that this browser
   * is not signed in, which means the browser did not keep the session's
   * cookie.
   */
  private async enter(): Promise<void> {
    await this.router.navigateByUrl('/');
    if (!this.stillHere()) return;
    await this.look();
    if (this.stillHere() && this.door() !== 'unknown' && !this.api.signedIn()) {
      this.failure.set(words.signIn.notKept);
    }
  }

  /** True while the router still shows this page. */
  private stillHere(): boolean {
    return this.router.url.split(/[?#]/)[0] === '/sign-in';
  }

  /**
   * The server refused. A 409 says that the door is not as this page showed
   * it: an owner's passkey was made meanwhile, or the list was emptied on
   * the server. So the page looks again, and the button follows. Then the
   * refusal's own line, unless the look itself failed and left its line.
   */
  private async refused(refusal: Refusal): Promise<void> {
    if (refusal.status === 409) {
      await this.look();
      if (this.door() === 'unknown') return;
    }
    this.failure.set(words.failure(refusal.status, refusal.phrase));
  }
}
