import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { env } from './config/env.js';
import { pool } from './config/db.js';
import { notFound, errorHandler } from './middleware/error.js';
import { startScheduler } from './jobs/scheduler.js';
import { uploadRoot } from './middleware/upload.js';

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

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Uploaded files (avatars, submission attachments)
app.use('/uploads', express.static(uploadRoot));

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
    if (req.path.startsWith('/api')) return next();
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
  startScheduler();
  app.listen(env.port, () => console.log(`[api] listening on http://localhost:${env.port}`));
}

start();
