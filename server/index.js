import { createApp } from './app.js';
import { config } from './config.js';
import { closePool } from './db/pool.js';
import { applySchema } from './db/schema.js';
import { startRegistry, stopRegistry } from './registry/registry.js';
import { startGithub, stopGithub } from './software/github.js';
import { startSweeps, stopSweeps } from './sweep/sweep.js';

/**
 * The start, in this order: the settings (the import of config.js), the
 * tables, the registry, the sweeps, then the listen on PORT (4400 by
 * default), on loopback. It says where everything is.
 *
 * A database that cannot be reached stops the start, so a wrong setting
 * fails loudly here and not at the first sweep. On monitor1 systemd starts
 * the server again five seconds later.
 */

/** The database as the log names it: the name, and the address or the socket's folder. */
const database = `${config.db.database} at ${
  config.db.host.startsWith('/') ? config.db.host : `${config.db.host}:${config.db.port}`
}`;

/** An error's message, or its code when the message is empty. */
function messageOf(err) {
  return err.message || err.code || String(err);
}

// The tables: db/schema.sql, applied before anything else uses the database.
try {
  await applySchema();
} catch (err) {
  console.error(`Could not apply db/schema.sql to ${database}: ${messageOf(err)}`);
  process.exit(1);
}

// The registry: the kept copy now, GitHub's file right after and every
// GITHUB_MINUTES. The newest commits on GitHub main, on the same clock.
// The sweeps: the shown states from the history, then the first sweep as
// soon as a registry is there, and one every SWEEP_SECONDS after it.
try {
  await startRegistry();
  startGithub();
  await startSweeps();
} catch (err) {
  console.error(`Could not read ${database}: ${messageOf(err)}`);
  process.exit(1);
}

const server = createApp().listen(config.port, '127.0.0.1', (err) => {
  if (err) {
    console.error(`Could not listen on port ${config.port}: ${messageOf(err)}`);
    process.exit(1);
  }
  console.log(`monitor listening on http://localhost:${config.port}`);
  console.log(`  origins    ${config.webOrigins.join(', ')}`);
  console.log(`  rp id      ${config.rpId}`);
  console.log(`  database   ${database}`);
  console.log(`  registry   ${config.registryUrl}`);
  console.log(`  sweep      every ${config.sweepSeconds} s, ${config.answerTimeoutSeconds} s for each answer`);
  console.log(`  build      ${config.distDir}`);
});

let shuttingDown = false;

/** Stop the clocks, stop accepting connections, let requests in flight finish, drain the pool. */
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopSweeps();
  stopGithub();
  stopRegistry();
  console.log(`\n${signal} received, shutting down...`);

  // Safety net: never hang forever if a connection refuses to close.
  setTimeout(() => {
    console.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000).unref();

  try {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await closePool();
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
