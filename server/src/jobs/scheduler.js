import cron from 'node-cron';
import { env } from '../config/env.js';
import { recomputeAllPerformance } from '../services/performance.service.js';
import { recomputeAllEngagement } from '../services/engagement.service.js';
import { markOverduePeerReviews } from '../services/peer-penalty.service.js';
import { getSettings } from '../services/settings.service.js';

export function startScheduler() {
  if (!cron.validate(env.scoringCron)) {
    console.warn(`[scheduler] invalid SCORING_CRON "${env.scoringCron}" - background scoring disabled.`);
    return;
  }
  cron.schedule(env.scoringCron, async () => {
    const started = Date.now();
    try {
      const settings = await getSettings();
      const overdue = await markOverduePeerReviews(settings);
      const perf = await recomputeAllPerformance();
      const eng = await recomputeAllEngagement();
      console.log(
        `[scheduler] scoring done in ${Date.now() - started}ms - missed-reviews:${overdue.marked}, performance:${perf} members, engagement newly-flagged:${eng.flaggedNew}`
      );
    } catch (err) {
      console.error('[scheduler] scoring failed:', err.message);
    }
  });
  console.log(`[scheduler] background scoring scheduled (${env.scoringCron}).`);
}
