import { recomputeAllPerformance } from '../services/performance.service.js';
import { recomputeAllEngagement } from '../services/engagement.service.js';

// Manual one-off run of the scoring pipeline (npm run jobs:run).
(async () => {
  console.log('Running performance + engagement recomputation...');
  const perf = await recomputeAllPerformance();
  const eng = await recomputeAllEngagement();
  console.log(`Done. Performance for ${perf} members; engagement newly flagged: ${eng.flaggedNew}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
