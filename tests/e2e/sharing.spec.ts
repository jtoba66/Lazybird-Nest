import { test, expect } from '@playwright/test';

// These tests start already authenticated via the storageState set in playwright.config.ts

test.describe('Sharing & Collaboration', () => {

  test('Create Drop Zone', async ({ page }) => {
    await page.goto('/shared');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Create Drop Zone' }).click();

    // Fill in the first visible text input in the modal
    const nameInput = page.locator('input[type="text"]:visible').first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill('E2E Drop Zone');

    await page.getByRole('button', { name: /Create/i }).first().click();

    await expect(page.locator('text=E2E Drop Zone')).toBeVisible({ timeout: 15000 });
  });

  test('Create Collab Folder', async ({ page }) => {
    await page.goto('/shared');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Create Collab Folder' }).click();

    const nameInput = page.locator('input[type="text"]:visible').first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill('E2E Collab');

    await page.getByRole('button', { name: /Create/i }).first().click();

    await expect(page.locator('text=E2E Collab')).toBeVisible({ timeout: 15000 });
  });
});
