import { defineConfig, devices } from '@playwright/test';

const PORT = 4300;

export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  // Production build served by the real server with a fresh SQLite file.
  webServer: {
    command: `rm -f data/e2e.db* && npm run build --silent && NODE_ENV=production PORT=${PORT} DB_PATH=data/e2e.db LOGIN_RATE_LIMIT=10000 node --disable-warning=ExperimentalWarning server/index.js`,
    url: `http://localhost:${PORT}/api/config`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
