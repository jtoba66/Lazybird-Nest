import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {

  // Auth tests need their OWN context (no pre-auth storageState)
  // so we clear storage before navigating
  test('Signup Flow', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/signup');
    await page.evaluate(() => localStorage.clear());

    const registerTab = page.locator('button:has-text("Register")');
    if (await registerTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await registerTab.click();
    }

    const email = `signup_test_${Date.now()}@test.local`;
    await page.fill('input[type="email"]', email);
    await page.locator('input[type="password"]').nth(0).fill('Password123!');
    await page.locator('input[type="password"]').nth(1).fill('Password123!');
    await page.locator('input[type="checkbox"]').click();
    await page.getByRole('button', { name: 'Create Account' }).click();

    await expect(page.locator('h1:has-text("Nest")')).toBeVisible({ timeout: 20000 });
  });

  test('Login Flow', async ({ page, context }) => {
    // Clear auth so we can test login from scratch
    await context.clearCookies();
    await page.goto('/signup');
    await page.evaluate(() => localStorage.clear());
    const registerTab = page.locator('button:has-text("Register")');
    if (await registerTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await registerTab.click();
    }

    const email = `login_test_${Date.now()}@test.local`;
    await page.fill('input[type="email"]', email);
    await page.locator('input[type="password"]').nth(0).fill('Password123!');
    await page.locator('input[type="password"]').nth(1).fill('Password123!');
    await page.locator('input[type="checkbox"]').click();
    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.locator('h1:has-text("Nest")')).toBeVisible({ timeout: 20000 });

    // Now log out and log back in
    await page.evaluate(() => localStorage.clear());
    await page.goto('/signup');

    const signinBtn = page.locator('button:has-text("Sign in")');
    if (await signinBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await signinBtn.click();
    }

    await page.fill('input[type="email"]', email);
    await page.locator('input[type="password"]').nth(0).fill('Password123!');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page.locator('h1:has-text("Nest")')).toBeVisible({ timeout: 20000 });
  });
});
