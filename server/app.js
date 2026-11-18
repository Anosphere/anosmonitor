import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { authRoutes } from './auth/auth.routes.js';
import { config } from './config.js';
import { overviewRoutes } from './overview/overview.routes.js';
import { newestSweep } from './sweep/sweep.js';

/**
 * The Express app (docs/schemas.md sections 9 and 11): the headers, then
 * the routes, then the page. Every route is under /api, JSON in and out.
 *
 * In front of the routes, in this order:
 *   1. The page's safety headers on every answer, and Cache-Control:
 *      no-store on every answer under /api.
 *   2. A POST or DELETE under /api that carries an Origin header that is
 *      not in WEB_ORIGIN is refused with 403.
 *   3. The JSON body is read, up to 64 KB.
 *
 * The routes:
 *   GET /api/health                     open to anyone, below
 *   server/auth/auth.routes.js          the door: /api/session,
 *                                       /api/passkey/..., /api/passkeys,
 *                                       /api/sign-out
 *   server/overview/overview.routes.js  /api/overview and
 *                                       /api/validators/:id/history, both
 *                                       only when signed in
 *
 * Behind the routes, in this order:
 *   1. A path under /api that no route answers is 404, as JSON.
 *   2. The page: the files of the Angular build in DIST_DIR, and its
 *      index.html for any other GET, so the page's own paths (/sign-in,
 *      /passkeys) load, also after a reload. The files hold no data.
 *   3. Anything else is 404, and an error is 500, both as JSON, so they
 *      carry the same headers as every other answer.
 *
 * Kept separate from index.js so it can be imported without opening a
 * port.
 */

/**
 * The page's safety headers (docs/schemas.md section 9.6). They are set
 * here and not by nginx, so the page runs under the same headers on the
 * operator's own machine as on monitor1.
 *
 * 'unsafe-inline' for styles is what Angular Material needs. The two
 * Google hosts are the fonts the page loads. script-src 'self' needs a
 * build that writes no script into the page itself.
 */
const HEADERS = Object.freeze({
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
});

/** The longest JSON body read, in bytes. A longer one is refused with 413. */
const BODY_MAX_BYTES = 64 * 1024;

/**
 * A POST or DELETE that carries an Origin header that is not in WEB_ORIGIN
 * is refused with 403, so another site's page cannot make the owner's
 * browser change anything here. A request with no Origin header goes on.
 */
function refuseOtherOrigins(req, res, next) {
  const { origin } = req.headers;
  const changes = req.method === 'POST' || req.method === 'DELETE';
  if (changes && origin !== undefined && !config.webOrigins.includes(origin)) {
    res.status(403).json({ error: 'origin not allowed' });
    return;
  }
  next();
}

/** A path no route answers: 404, as JSON. */
function notFound(req, res) {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
}

/**
 * The page for a GET that no route and no file of the build answered: the
 * build's index.html, so the page's own paths load. `dist` is the build's
 * folder. Another method goes on to the 404. With no build in the folder,
 * the answer says how to make one.
 */
function pageFrom(dist) {
  const index = resolve(dist, 'index.html');
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    if (!existsSync(index)) {
      res.status(404).type('text/plain').send(`no build at ${dist}: run npm run build`);
      return;
    }
    res.sendFile('index.html', { root: dist });
  };
}

/**
 * The last stop for an error. Express knows an error handler by its four
 * parameters, so `next` stays though nothing calls it. Express sends a
 * rejected promise of an async route here by itself.
 *
 * An error that carries a status from 400 to 499 is a request that could
 * not be read: a body that is too long or is not JSON, or a path that
 * cannot be decoded. It is answered with that status. Anything else, a
 * database that does not answer for one, is logged and answered with 500.
 */
function errorHandler(err, req, res, next) {
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(`${req.method} ${req.path} failed: ${err?.stack ?? err}`);
  res.status(status).json({ error: status === 500 ? 'Internal Server Error' : 'bad request' });
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set(HEADERS);
    next();
  });
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', refuseOtherOrigins);
  app.use('/api', express.json({ limit: BODY_MAX_BYTES }));

  // GET /api/health, open to anyone: the server runs, and when its newest
  // sweep started. `lastSweepAt` is null until the first sweep.
  app.get('/api/health', (req, res) => {
    const newest = newestSweep();
    res.json({ status: 'ok', lastSweepAt: newest === null ? null : newest.sweptAt.toISOString() });
  });

  app.use(authRoutes);
  app.use(overviewRoutes);

  // A path under /api that no route answers: 404 as JSON, before the build
  // is looked at.
  app.use('/api', notFound);

  // The page: the Angular build's files, and its index.html for any other
  // GET.
  const dist = resolve(config.distDir);
  app.use(express.static(dist, { index: 'index.html' }));
  app.use(pageFrom(dist));

  // Order matters: these two come after everything else.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
