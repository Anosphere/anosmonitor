import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ApiService } from './services/api.service';

/**
 * In front of the overview and the passkeys page (docs/schemas.md section
 * 11.1): asks GET /api/session and sends a visitor who is not signed in to
 * /sign-in. A server that does not answer counts as not signed in; the
 * sign-in page then says that it does not answer.
 */
export const sessionGuard: CanActivateFn = async () => {
  const api = inject(ApiService);
  const router = inject(Router);
  const session = await api.session();
  return session.ok && session.body.signedIn ? true : router.createUrlTree(['/sign-in']);
};
