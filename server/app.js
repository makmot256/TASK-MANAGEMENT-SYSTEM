/**
 * Entry point for cPanel's Application Manager.
 *
 * cPanel expects the startup file to be called `app.js` at the application
 * path, so this exists purely to satisfy that convention and hand off to the
 * real entry point. Everything else — Docker, `npm start`, local development —
 * still runs `src/index.js` directly.
 *
 * This file is ESM, because server/package.json declares `"type": "module"`.
 * If Passenger fails to load it with ERR_REQUIRE_ESM (some builds `require()`
 * the startup file rather than spawning node), switch to the CommonJS shim:
 *
 *     .htaccess:  PassengerStartupFile passenger.cjs
 *
 * See docs/DEPLOYMENT-CPANEL.md.
 */
import './src/index.js';
