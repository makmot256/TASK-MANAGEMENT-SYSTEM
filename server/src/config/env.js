import dotenv from 'dotenv';
dotenv.config();

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const env = {
  port: num(process.env.PORT, 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'task_management_system',
  },

  jwtSecret: process.env.JWT_SECRET || 'dev_insecure_secret_change_me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  sessionIdleMinutes: num(process.env.SESSION_IDLE_MINUTES, 30),

  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  maxUploadMb: num(process.env.MAX_UPLOAD_MB, 1024),
  maxUploadFiles: num(process.env.MAX_UPLOAD_FILES, 10),

  engagementRiskThreshold: num(process.env.ENGAGEMENT_RISK_THRESHOLD, 40),
  scoringCron: process.env.SCORING_CRON || '0 2 * * *',
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
