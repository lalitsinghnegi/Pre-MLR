import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Several suites crawl a site or start a browser in beforeAll; under parallel load that can
    // exceed the 10s default.
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // server.ts only wires up and listens; facts-script is browser code run inside Playwright.
      exclude: ['src/server.ts', 'src/crawler/facts-script.ts'],
      reporter: ['text-summary', 'text', 'html'],
    },
  },
});
