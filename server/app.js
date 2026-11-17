import express from 'express';
import { newestSweep } from './sweep/sweep.js';

/**
 * The Express app. One route so far, open to anyone: GET /api/health says
 * that the server runs, and when its last sweep started.
 *
 *   { "status": "ok", "lastSweepAt": <time or null> }
 *
 * `lastSweepAt` is null until the first sweep. Kept separate from
 * index.js so it can be imported without opening a port.
 */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/health', (req, res) => {
    const newest = newestSweep();
    res.json({ status: 'ok', lastSweepAt: newest === null ? null : newest.sweptAt.toISOString() });
  });

  return app;
}
