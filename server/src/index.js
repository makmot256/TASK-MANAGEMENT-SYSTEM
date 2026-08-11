import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { env } from './config/env.js';
import { pool } from './config/db.js';
import { notFound, errorHandler } from './middleware/error.js';
import { startScheduler } from './jobs/scheduler.js';
import { avatarRoot } from './middleware/upload.js';

import authRoutes from './routes/auth.routes.js';
import adminRoutes from './routes/admin.routes.js';
import usersRoutes from './routes/users.routes.js';
import tasksRoutes from './routes/tasks.routes.js';
import reportsRoutes from './routes/reports.routes.js';
import peerRoutes from './routes/peer.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import teamRoutes from './routes/team.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors({ origin: env.clientOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// S8: stop browsers guessing a content type for anything we serve, and keep
// uploaded documents from ever being rendered inline.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// S1: only the avatar subtree is public. Task briefings and submission
// attachments stay private and are reachable exclusively through
// GET /api/tasks/:taskId/files/:fileId and GET /api/submissions/:id/files/:fileId,
// both of which apply the same scope checks as the records they belong to.
app.use(
  '/uploads/avatars',
  express.static(avatarRoot, {
    index: false,
    dotfiles: 'deny',
    setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=86400'),
  })
);

// API modules
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/submissions', reportsRoutes);
app.use('/api/peer', peerRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/team', teamRoutes);

// Serve the built client in production, if present.
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    // /uploads must fall through to the 404 handler rather than being answered
    // with index.html. A missing or non-public upload returning 200 + HTML is
    // indistinguishable from a served file at the status-code level, which
    // makes the S1 boundary impossible to test from the outside.
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use(notFound);
app.use(errorHandler);

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log(`[db] connected to "${env.db.database}" at ${env.db.host}:${env.db.port}`);
  } catch (err) {
    console.error('[db] connection failed:', err.message);
    console.error('  -> Did you run "npm run db:setup" and is MySQL running?');
  }
  if (env.runScheduler) startScheduler();
  else console.log('[scheduler] disabled in this process (RUN_SCHEDULER=false).');
  app.listen(env.port, () => console.log(`[api] listening on http://localhost:${env.port}`));
}

start();
