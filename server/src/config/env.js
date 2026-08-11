import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve .env relative to this file, not the working directory. Application
// servers such as Passenger do not guarantee cwd is the application root, and a
// silently unloaded .env means JWT_SECRET looks unset — which now refuses to
// start in production, presenting as "could not be started" with no clue why.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

const nodeEnv = process.env.NODE_ENV || 'development';

// S2: a deployment that forgets .env must not silently sign tokens with a key
// that is committed to this repository. Development still gets a usable default,
// loudly.
const DEV_JWT_SECRET = 'dev_insecure_secret_change_me';
function resolveJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret && secret !== DEV_JWT_SECRET) return secret;
  if (nodeEnv !== 'development') {
    console.error(
      '[env] JWT_SECRET is missing or still the development default. ' +
        'Refusing to start outside development — set a strong random value ' +
        '(openssl rand -hex 32).'
    );
    process.exit(1);
  }
  console.warn('[env] JWT_SECRET unset — using an insecure development key. Never deploy this.');
  return DEV_JWT_SECRET;
}

export const env = {
  port: num(process.env.PORT, 4000),
  nodeEnv,
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'task_management_system',
  },

  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  sessionIdleMinutes: num(process.env.SESSION_IDLE_MINUTES, 30),

  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  // S9: 25 MB is generous for the PDF/DOCX this accepts. The old 1 GB default
  // let one authenticated member push 10 GB per request onto local disk.
  maxUploadMb: num(process.env.MAX_UPLOAD_MB, 25),
  maxUploadFiles: num(process.env.MAX_UPLOAD_FILES, 10),
  // Total bytes one member may hold across all attachments.
  memberStorageQuotaMb: num(process.env.MEMBER_STORAGE_QUOTA_MB, 500),

  // S4: reset links are built from this, never from a request header.
  publicUrl:
    process.env.PUBLIC_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  // S3: failed logins per account and per IP inside the window.
  loginMaxFailuresPerAccount: num(process.env.LOGIN_MAX_FAILURES_PER_ACCOUNT, 10),
  loginMaxFailuresPerIp: num(process.env.LOGIN_MAX_FAILURES_PER_IP, 30),
  loginFailureWindowMinutes: num(process.env.LOGIN_FAILURE_WINDOW_MINUTES, 15),

  engagementRiskThreshold: num(process.env.ENGAGEMENT_RISK_THRESHOLD, 40),
  scoringCron: process.env.SCORING_CRON || '0 2 * * *',
  // Defaults to true so single-process runs are unchanged. Set false on API
  // replicas when a dedicated scheduler process owns the nightly job.
  runScheduler: process.env.RUN_SCHEDULER !== 'false',
  peerReviewersPerSubmission: num(process.env.PEER_REVIEWERS_PER_SUBMISSION, 3),

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: num(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Task Management System <no-reply@tms.local>',
  },

  seedAdmin: {
    email: process.env.SEED_ADMIN_EMAIL || 'admin@tms.local',
    password: process.env.SEED_ADMIN_PASSWORD || 'Admin@123',
  },
};
