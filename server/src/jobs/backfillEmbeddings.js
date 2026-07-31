import { pool } from '../config/db.js';
import { backfillAllEmbeddings } from '../services/similarity.service.js';

console.log('> Backfilling submission embeddings (first run downloads the model)...');
const result = await backfillAllEmbeddings();
console.log('> Done:', result);
await pool.end();
