// Small helper to throw HTTP errors with a status code.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wrap async route handlers so thrown errors reach the error middleware.
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function notFound(req, res) {
  res.status(404).json({ message: 'Resource not found.' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Friendly messages for file-upload (multer) errors.
  if (err && err.name === 'MulterError') {
    const map = {
      LIMIT_FILE_SIZE: 'One of the files is too large. Each file may be up to 1 GB.',
      LIMIT_FILE_COUNT: 'Too many files attached at once.',
      LIMIT_UNEXPECTED_FILE: 'Unexpected file field in the upload.',
    };
    return res.status(413).json({ message: map[err.code] || 'File upload failed.' });
  }

  // Database unreachable (MySQL/XAMPP not running).
  const dbDown =
    err?.code === 'ECONNREFUSED' ||
    err?.code === 'PROTOCOL_CONNECTION_LOST' ||
    err?.fatal === true ||
    (err?.name === 'AggregateError' &&
      Array.isArray(err.errors) &&
      err.errors.some((e) => e?.code === 'ECONNREFUSED'));
  if (dbDown) {
    console.error('[db] unreachable:', err.code || err.message);
    return res.status(503).json({
      message: 'Database is offline. Start MySQL in XAMPP, then try again.',
    });
  }

  const status = err.status || 500;
  if (status >= 500) console.error(err);
  // Never leak empty AggregateError messages as "Something went wrong."
  const message =
    (err.message && err.message.trim()) ||
    (status === 500 ? 'Server error. Please try again.' : 'Request failed.');
  res.status(status).json({ message });
}
