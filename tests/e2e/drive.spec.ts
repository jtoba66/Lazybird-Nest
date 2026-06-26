import { test, expect } from './fixtures';
import fs from 'fs';

// These tests start already authenticated via the storageState set in playwright.config.ts

test.describe('Cloud Drive Features', () => {

  test('Create Folder and Delete Folder', async ({ page }) => {
    await page.goto('/folders');
    // FoldersPage has no <h1> (it uses a breadcrumb nav). Wait for the action we need instead.
    const newFolderBtn = page.getByRole('button', { name: 'New Folder' });
    await expect(newFolderBtn).toBeVisible({ timeout: 10000 });

    await newFolderBtn.click();

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

  test('Upload, Download+Decrypt, and Delete File', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('h1:has-text("Nest")')).toBeVisible({ timeout: 10000 });

    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached({ timeout: 10000 });

    const ORIGINAL = 'E2E zero-knowledge upload test — round-trip marker 12345';
    await fileInput.setInputFiles({
      name: 'e2e-test-file.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(ORIGINAL),
    });

    // Wait for upload progress to appear then disappear
    await expect(page.getByText(/Encrypting/i)).toBeVisible({ timeout: 10000 }).catch(() => {});
    await expect(page.getByText(/Encrypting/i)).not.toBeVisible({ timeout: 30000 }).catch(() => {});

    // Scope to the table row — a success toast also quotes the filename, which would
    // make a bare text= locator ambiguous under Playwright strict mode.
    const fileRow = page.locator('tr').filter({ hasText: 'e2e-test-file.txt' });
    await expect(fileRow).toBeVisible({ timeout: 15000 });

    // Real round-trip: the owner download GETs the encrypted blob from local storage, decrypts
    // it in-browser via the app's own crypto, then triggers an <a download> of the plaintext.
    // Reading that download and asserting the bytes proves storage persisted real ciphertext AND
    // the ZK decrypt path works end-to-end.
    await fileRow.hover();
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await fileRow.locator('button[title="Download"]').click();
    const download = await downloadPromise;
    const savedPath = await download.path();
    expect(fs.readFileSync(savedPath, 'utf-8')).toBe(ORIGINAL);

    await fileRow.hover();
    await fileRow.getByRole('button', { name: 'Delete' }).click();

    const confirmBtn = page.getByRole('button', { name: 'Delete' }).last();
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    await expect(page.locator('tr').filter({ hasText: 'e2e-test-file.txt' })).toHaveCount(0, { timeout: 10000 });
  });
});
