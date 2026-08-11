/**
 * Passenger entry point for cPanel's "Setup Node.js App".
 *
 * Only needed if Passenger fails to start `src/index.js` directly. The server is
 * ESM (`"type": "module"` in package.json), and some Passenger builds load the
 * startup file with a CommonJS `require()`, which throws ERR_REQUIRE_ESM. This
 * shim is CommonJS, so Passenger can always load it, and it reaches the real
 * entry point through a dynamic import.
 *
 * If `src/index.js` starts fine on its own, delete this file — one entry point
 * is better than two.
 *
 * Set the startup file in cPanel to:  passenger.cjs
 */
import('./src/index.js').catch((err) => {
  console.error('[passenger] failed to start the application:', err);
  process.exit(1);
});
