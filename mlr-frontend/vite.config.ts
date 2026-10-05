/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dev: forward API calls to the Fastify backend so no CORS setup is needed.
    // Keep the browser's Host header: the API accepts state-changing requests only from its own
    // origin (or CORS_ORIGIN).
    proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/main.tsx', 'src/**/*.test.{ts,tsx}'],
      reporter: ['text-summary', 'text', 'html'],
    },
  },
});
