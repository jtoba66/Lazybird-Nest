import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  globalSetup: path.resolve(__dirname, './tests/e2e/global-setup.ts'),
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    // Every test starts already authenticated — no login needed
    storageState: 'tests/.auth/user.json',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'doppler run -- npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 120 * 1000,
    },
    {
      command: 'cd server && doppler run -- sh -c "PORT=3004 NODE_ENV=test DATABASE_URL=postgresql://localhost:5432/nest_test SMTP_USER=\\\"\\\" SMTP_PASS=\\\"\\\" npm run dev"',
      url: 'http://localhost:3004/health',
      reuseExistingServer: true,
      timeout: 120 * 1000,
    }
  ],
});
