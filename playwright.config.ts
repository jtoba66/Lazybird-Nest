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
  // IMPORTANT: the test harness is fully local and deliberately does NOT use `doppler run`.
  // Doppler's `dev` config carries LIVE keys (live Supabase DB, live Obsideo storage, real
  // SMTP). If the test server inherited those, the upload/email tests would write to and send
  // from production services. So every secret below is a local throwaway, the DB is local
  // Postgres (nest_test), mail goes to MailDev (:1025), and STORAGE_PROVIDER=local persists
  // encrypted bytes to the server's own disk (server/uploads/local-store) so upload→download
  // round-trips work end-to-end without ever reaching Jackal or live Obsideo.
  webServer: [
    {
      // Frontend SPA — no Doppler. In dev mode src/config/api.ts already defaults to
      // localhost:3004; we pin VITE_API_URL explicitly so nothing can redirect it to prod.
      command: 'VITE_API_URL=http://localhost:3004/api npx vite --port 5173',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 120 * 1000,
    },
    {
      // Backend — no Doppler. `npm run dev` re-invokes `doppler run`, so we run ts-node directly.
      command: 'cd server && TS_NODE_TRANSPILE_ONLY=true '
        + 'PORT=3004 NODE_ENV=test '
        + 'DATABASE_URL=postgresql://localhost:5432/nest_test '
        + 'STORAGE_PROVIDER=local '
        + 'JACKAL_SEED="test test test test test test test test test test test junk" '
        + 'JWT_SECRET=local-test-jwt-secret-not-for-production '
        + 'STRIPE_SECRET_KEY=sk_test_local_dummy '
        + 'STRIPE_WEBHOOK_SECRET=whsec_local_dummy '
        // Mail genuinely ON: sendEmail() skips when SMTP_USER/PASS are blank, so we set dummy
        // non-empty creds. MailDev (:1025) ignores auth and captures every message for assertion.
        + 'SMTP_HOST=localhost SMTP_PORT=1025 SMTP_USER=test SMTP_PASS=test EMAIL_FROM="Nest Test <test@nest.local>" '
        + 'npx ts-node --transpile-only src/server.ts',
      url: 'http://localhost:3004/health',
      reuseExistingServer: true,
      timeout: 120 * 1000,
    }
  ],
});
