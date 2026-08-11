import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { env } from '../config/env.js';

// S1: two storage roots, not one.
//
//   uploadRoot/            task briefings + submission attachments — PRIVATE,
//                          reachable only through the scope-checked download routes
//   uploadRoot/avatars/    profile images — safe to serve as static files
//
// Previously everything shared one flat directory that was mounted with
// express.static, so anyone who learned a stored filename could read a member's
// submitted work without a token.
const uploadRoot = path.resolve(process.cwd(), env.uploadDir);
const avatarRoot = path.join(uploadRoot, 'avatars');
fs.mkdirSync(uploadRoot, { recursive: true });
fs.mkdirSync(avatarRoot, { recursive: true });

const ALLOWED = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function randomName(originalName) {
  const id = crypto.randomBytes(8).toString('hex');
  // Take the extension from our own allowlist check, never from user input
  // verbatim, so a crafted name cannot introduce path separators.
  const ext = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '');
  return `${Date.now()}-${id}${ext}`;
}

const documentStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadRoot),
  filename: (req, file, cb) => cb(null, randomName(file.originalname)),
});

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, avatarRoot),
  filename: (req, file, cb) => cb(null, randomName(file.originalname)),
});

// S8: both the declared MIME type and the extension must pass. The previous
// `||` meant either alone was sufficient, so arbitrary content could be stored
// under a .pdf name, or any name with a spoofed Content-Type.
export const upload = multer({
  storage: documentStorage,
  limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: env.maxUploadFiles },
  fileFilter: (req, file, cb) => {
    const extOk = /\.(pdf|docx?)$/i.test(file.originalname);
    const mimeOk = ALLOWED.has(file.mimetype);
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error('Unsupported file type. Only PDF and DOCX are allowed.'));
  },
});

export const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const extOk = /\.(jpe?g|png|webp|gif)$/i.test(file.originalname);
    const mimeOk = IMAGE_TYPES.has(file.mimetype);
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error('Unsupported image type. Use JPG, PNG, WEBP, or GIF.'));
  },
});

/** Best-effort removal of files written before a failed transaction. (D4) */
export async function unlinkUploaded(files = []) {
  await Promise.all(
    files.map((f) =>
      fs.promises.unlink(path.join(uploadRoot, f.filename)).catch(() => {})
    )
  );
}

export { uploadRoot, avatarRoot };
