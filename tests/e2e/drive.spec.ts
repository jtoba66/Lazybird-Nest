import { test, expect } from '@playwright/test';

// These tests start already authenticated via the storageState set in playwright.config.ts

test.describe('Cloud Drive Features', () => {

  test('Create Folder and Delete Folder', async ({ page }) => {
    await page.goto('/folders');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'New Folder' }).click();

    const folderInput = page.locator('input[placeholder="Enter folder name"]');
    await expect(folderInput).toBeVisible({ timeout: 5000 });
    await folderInput.fill('Test E2E Folder');
    await page.getByRole('button', { name: 'Create Folder' }).click();

    await expect(page.getByRole('cell', { name: /Test E2E Folder/ })).toBeVisible({ timeout: 15000 });

    const folderRow = page.locator('tr').filter({ hasText: 'Test E2E Folder' });
    await folderRow.hover();
    await folderRow.getByRole('button', { name: 'Delete' }).click();

    // Confirm if modal appears
    const confirmBtn = page.getByRole('button', { name: 'Delete' }).last();
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    await expect(page.getByRole('cell', { name: /Test E2E Folder/ })).not.toBeVisible({ timeout: 10000 });
  });

  test('Upload File and Delete File', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('h1:has-text("Nest")')).toBeVisible({ timeout: 10000 });

    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached({ timeout: 10000 });

    await fileInput.setInputFiles({
      name: 'e2e-test-file.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('E2E zero-knowledge upload test'),
    });

    // Wait for upload progress to appear then disappear
    await expect(page.getByText(/Encrypting/i)).toBeVisible({ timeout: 10000 }).catch(() => {});
    await expect(page.getByText(/Encrypting/i)).not.toBeVisible({ timeout: 30000 }).catch(() => {});

    await expect(page.locator('text=e2e-test-file.txt')).toBeVisible({ timeout: 15000 });

    const fileRow = page.locator('tr').filter({ hasText: 'e2e-test-file.txt' });
    await fileRow.hover();
    await fileRow.getByRole('button', { name: 'Delete' }).click();

    const confirmBtn = page.getByRole('button', { name: 'Delete' }).last();
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    await expect(page.locator('text=e2e-test-file.txt')).not.toBeVisible({ timeout: 10000 });
  });
});
