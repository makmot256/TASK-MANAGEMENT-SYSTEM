import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { env } from '../config/env.js';

const uploadRoot = path.resolve(process.cwd(), env.uploadDir);
fs.mkdirSync(uploadRoot, { recursive: true });

const ALLOWED = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadRoot),
  filename: (req, file, cb) => {
    const id = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}-${id}${path.extname(file.originalname)}`);
  },
});

// SRS 4.1: only PDF / DOCX proof-of-work uploads are accepted.
// Supports multiple files per submission, up to env.maxUploadMb each (default 1GB).
export const upload = multer({
  storage,
  limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: env.maxUploadFiles },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype) || /\.(pdf|docx?)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Unsupported file type. Only PDF and DOCX are allowed.'));
  },
});

export { uploadRoot };
