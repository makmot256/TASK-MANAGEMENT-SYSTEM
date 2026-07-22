import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        timeout: 30000,
        proxyTimeout: 30000,
        // Avoid hanging the browser when the API briefly restarts under --watch.
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            console.warn('[vite] api proxy error:', err.message);
            if (res && !res.headersSent && typeof (res as any).writeHead === 'function') {
              (res as any).writeHead(502, { 'Content-Type': 'application/json' });
              (res as any).end(JSON.stringify({ message: 'API temporarily unavailable. Retrying…' }));
            }
          });
        },
      },
      '/uploads': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
});
