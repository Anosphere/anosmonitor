import { Routes } from '@angular/router';
import { OverviewPage } from './pages/overview/overview.page';
import { PasskeysPage } from './pages/passkeys/passkeys.page';
import { SignInPage } from './pages/sign-in/sign-in.page';
import { sessionGuard } from './session.guard';
import { words } from './words';

/**
 * The routes (docs/schemas.md section 11.1). The sign-in page is open to
 * anyone; the overview and the passkeys page need the session. Any other
 * path leads to the overview, and so, for a visitor who is not signed in,
 * to the sign-in page.
 */
export const routes: Routes = [
  { path: 'sign-in', component: SignInPage, title: words.title },
  { path: '', pathMatch: 'full', component: OverviewPage, canActivate: [sessionGuard], title: words.title },
  { path: 'passkeys', component: PasskeysPage, canActivate: [sessionGuard], title: words.passkeys.title },
  { path: '**', redirectTo: '' },
];
