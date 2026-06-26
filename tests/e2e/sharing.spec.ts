import { test, expect } from './fixtures';

// These tests start already authenticated via the storageState in playwright.config.ts.
// The `page` fixture (./fixtures) re-injects the ZK masterKey into sessionStorage, which
// storageState cannot persist — without it the vault stays locked and we bounce to /login.

test.describe('Sharing & Collaboration', () => {

  test('Create Drop Zone', async ({ page }) => {
    await page.goto('/shared');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 10000 });

    // Open the modal (page trigger). Once open, the submit button shares this label,
    // so disambiguate the two later with .last().
    await page.getByRole('button', { name: 'Create Drop Zone' }).click();

    const nameInput = page.locator('input[placeholder="e.g. Acme Project Assets"]');
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill('E2E Drop Zone');

    // The modal's submit button (last "Create Drop Zone" on the page).
    await page.getByRole('button', { name: 'Create Drop Zone' }).last().click();

    // Success advances the modal to step 2 (ZK keygen + server create can take a moment).
    await expect(page.getByText('Drop Zone Created!')).toBeVisible({ timeout: 20000 });
  });

  test('Create Collab Folder', async ({ page }) => {
    await page.goto('/shared');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'New Collab Folder' }).click();

    const nameInput = page.locator('input[placeholder="e.g. Acme Marketing Sync"]');
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill('E2E Collab');

    // A collab folder requires at least one collaborator email, else submit just warns.
    const emailInput = page.locator('input[placeholder="Enter guest email and press enter"]');
    await emailInput.fill('guest@test.local');
    await page.getByRole('button', { name: 'Add' }).click();

    await page.getByRole('button', { name: 'Create Folder' }).click();

    await expect(page.getByText('Collab Folder Created!')).toBeVisible({ timeout: 20000 });
  });
});
