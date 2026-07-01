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
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ message: err.message || 'Something went wrong.' });
}
