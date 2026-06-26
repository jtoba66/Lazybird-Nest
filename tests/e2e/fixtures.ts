/**
 * E2E Auth Setup Fixture
 *
 * Signs up a user directly via API and saves localStorage auth tokens
 * into a Playwright storageState file. Tests that import `authenticatedPage`
 * start already logged in with a valid session — no UI login loop needed.
 */

import { test as base, expect, Browser, BrowserContext, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_URL = 'http://localhost:3004';
const STORAGE_DIR = path.resolve(__dirname, '../.auth');

export interface AuthUser {
  email: string;
  password: string;
  token: string;
  masterKeyHex: string;
}

/**
 * Creates a brand new user via the signup API and returns auth credentials.
 * We call the API directly rather than through the UI to avoid rate limits
 * and fragile UI interactions in beforeAll/beforeEach hooks.
 */
export async function createTestUser(browser: Browser, suffix = ''): Promise<AuthUser> {
  const email = `e2e_${suffix}_${Date.now()}@test.local`;
  const password = 'Password123!';

  // We need to create a real keypair because Nest is zero-knowledge.
  // We'll use the page's crypto via evaluate to generate keys properly.
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/signup');

  // Wait for the page to load the crypto library
  await page.waitForLoadState('networkidle');

  // Use the page to perform signup via the real UI (needed for ZK key gen)
  const registerTab = page.locator('button:has-text("Register")');
  if (await registerTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await registerTab.click();
  }

  await page.fill('input[type="email"]', email);
  await page.locator('input[type="password"]').nth(0).fill(password);
  await page.locator('input[type="password"]').nth(1).fill(password);
  await page.locator('input[type="checkbox"]').click();
  await page.getByRole('button', { name: 'Create Account' }).click();

  // Wait for dashboard to confirm login succeeded
  await expect(page.locator('h1:has-text("Nest")')).toBeVisible({ timeout: 20000 });

  // Extract the auth tokens from localStorage
  const token = await page.evaluate(() => localStorage.getItem('nest_token') || '');
  const refreshToken = await page.evaluate(() => localStorage.getItem('nest_refresh_token') || '');
  const encryptedMasterKey = await page.evaluate(() => localStorage.getItem('nest_encrypted_master_key') || '');
  const encryptedMasterKeyNonce = await page.evaluate(() => localStorage.getItem('nest_encrypted_master_key_nonce') || '');
  const role = await page.evaluate(() => localStorage.getItem('nest_role') || 'user');

  // Save the full browser storage state to disk so other tests can reuse it
  if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
  const storageFile = path.join(STORAGE_DIR, `${suffix || 'default'}.json`);

  await page.context().storageState({ path: storageFile });
  await page.close();

  return { email, password, token, masterKeyHex: '' };
}

// Custom fixture: provides a page that's already authenticated
export const test = base.extend<{
  authenticatedPage: Page;
  authUser: AuthUser;
}, {
  sharedContext: BrowserContext;
  sharedUser: AuthUser;
}>({
  // Worker-scoped: created once per worker, shared across all tests in a file
  sharedUser: [async ({ browser }, use, workerInfo) => {
    const suffix = `worker${workerInfo.workerIndex}`;
    const user = await createTestUser(browser, suffix);
    await use(user);
  }, { scope: 'worker' }],

  sharedContext: [async ({ browser, sharedUser }, use, workerInfo) => {
    const storageFile = path.join(STORAGE_DIR, `worker${workerInfo.workerIndex}.json`);
    const ctx = await browser.newContext({ storageState: storageFile });
    await use(ctx);
    await ctx.close();
  }, { scope: 'worker' }],

  // Test-scoped: each test gets a fresh page but with the worker's auth state
  authUser: async ({ sharedUser }, use) => {
    await use(sharedUser);
  },

  authenticatedPage: async ({ sharedContext }, use) => {
    const page = await sharedContext.newPage();
    await use(page);
    await page.close();
  },
});

export { expect };
