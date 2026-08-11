import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { startScheduler } from './scheduler.js';

// Scheduler-only entrypoint (npm run jobs:scheduler).
//
// Runs the nightly scoring cron with no HTTP listener, so the API can be scaled
// to several replicas with RUN_SCHEDULER=false while exactly one process owns
// the job. Without this split every replica would recompute the same snapshots
// and re-send the same at-risk emails.
async function main() {
  try {
    await pool.query('SELECT 1');
    console.log(`[db] connected to "${env.db.database}" at ${env.db.host}:${env.db.port}`);
  } catch (err) {
    console.error('[db] connection failed:', err.message);
    process.exit(1);
  }

  startScheduler();
  console.log('[scheduler] standalone scheduler process running.');
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`\n[scheduler] ${sig} received, shutting down.`);
    await pool.end().catch(() => {});
    process.exit(0);
  });
}

main();
