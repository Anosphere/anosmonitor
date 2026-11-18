import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { ApiService } from './services/api.service';
import { words } from './words';

/**
 * The shell (docs/schemas.md section 11.4, item 1): a bar on top with the
 * title and, on the right, a menu with "Passkeys" and "Sign out"; under it
 * the page. The bar shows only while this browser is signed in, so the
 * sign-in page stands alone, with the title of its own. The title in the
 * bar is a link to the overview.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, MatToolbarModule, MatMenuModule, MatIconModule, MatButtonModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly w = words;

  /** "Sign out": the server ends the session, then the sign-in page. It reads the session anew, so it shows what is true also when the server did not answer. */
  protected async signOut(): Promise<void> {
    await this.api.signOut();
    await this.router.navigateByUrl('/sign-in');
  }
}
