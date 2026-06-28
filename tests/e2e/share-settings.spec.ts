import { test, expect } from './fixtures';

// Regression coverage for the Share Settings modal across ALL share types: the displayed
// "Shareable Link" + QR must never present an incomplete/undecryptable link.
//   - standard_link: key lives in #key fragment -> re-derived client-side, link+QR complete
//   - drop_zone:     no secret in the URL (recipient seals to host pubkey) -> base URL is complete
//   - collab_folder: linkKey (#lk) is NOT stored server-side -> warn + no QR until "Regenerate Link"
//
// A scannable QR is rendered as a button[title="Click to enlarge and download"]; the
// incomplete state shows a text placeholder instead. We assert on that distinction.

const QR_BUTTON = 'button[title="Click to enlarge and download"]';

async function openSettingsFor(page: import('@playwright/test').Page, rowText: string) {
  await page.goto('/shared');
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 10000 });
  const row = page.locator('tr').filter({ hasText: rowText }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.hover();
  await row.locator('button[title="Settings & Audit Logs"]').click();
}

test.describe('Share Settings link integrity (all types)', () => {

  test('standard file link: full URL with #key + real QR', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('h1:has-text("Nest")')).toBeVisible({ timeout: 10000 });

    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached({ timeout: 10000 });
    const NAME = 'share-settings-e2e.txt';
    await fileInput.setInputFiles({
      name: NAME, mimeType: 'text/plain', buffer: Buffer.from('share settings key integrity test 999'),
    });
    await expect(page.getByText(/Encrypting/i)).toBeVisible({ timeout: 10000 }).catch(() => {});
    await expect(page.getByText(/Encrypting/i)).not.toBeVisible({ timeout: 30000 }).catch(() => {});

    const fileRow = page.locator('tr').filter({ hasText: NAME });
    await expect(fileRow).toBeVisible({ timeout: 15000 });
    await fileRow.hover();
    await fileRow.locator('button[title="Share"]').click();
    await expect(page.getByText('Ready to Share!')).toBeVisible({ timeout: 20000 });

    await openSettingsFor(page, NAME);

    const linkInput = page.locator('input[readonly]').first();
    await expect(linkInput).toBeVisible({ timeout: 10000 });
    await expect.poll(async () => (await linkInput.inputValue()) || '', { timeout: 15000 }).toContain('#key=');
    const val = await linkInput.inputValue();
    expect(val).toContain('/s/');
    expect(val).toContain('#key=');
    expect(val).toContain('&name=');
    // Real scannable QR (not the incomplete placeholder).
    await expect(page.locator(QR_BUTTON)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Generating QR|Link key unavailable|Regenerate link for QR/)).toHaveCount(0);
  });

  test('drop zone: complete /dz/ URL + real QR (no key needed)', async ({ page }) => {
    await page.goto('/shared');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Create Drop Zone' }).click();
    const NAME = 'E2E DZ Settings';
    const nameInput = page.locator('input[placeholder="e.g. Acme Project Assets"]');
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill(NAME);
    await page.getByRole('button', { name: 'Create Drop Zone' }).last().click();
    await expect(page.getByText('Drop Zone Created!')).toBeVisible({ timeout: 20000 });

    await openSettingsFor(page, NAME);

    const linkInput = page.locator('input[readonly]').first();
    await expect(linkInput).toBeVisible({ timeout: 10000 });
    const val = await linkInput.inputValue();
    expect(val).toContain('/dz/');
    // Drop-zone URLs carry no secret -> the link is complete and the QR must be scannable.
    await expect(page.locator(QR_BUTTON)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Generating QR|Link key unavailable|Regenerate link for QR/)).toHaveCount(0);
  });

  test('collab folder: warns + suppresses QR until link regenerated, then #lk + real QR', async ({ page }) => {
    await page.goto('/shared');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'New Collab Folder' }).click();
    const NAME = 'E2E Collab Settings';
    const nameInput = page.locator('input[placeholder="e.g. Acme Marketing Sync"]');
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill(NAME);
    const emailInput = page.locator('input[placeholder="Enter guest email and press enter"]');
    await emailInput.fill('guest@test.local');
    await page.getByRole('button', { name: 'Add' }).click();
    await page.getByRole('button', { name: 'Create Folder' }).click();
    await expect(page.getByText('Collab Folder Created!')).toBeVisible({ timeout: 20000 });

    await openSettingsFor(page, NAME);

    // Before regeneration: incomplete link is flagged and NO scannable QR is shown.
    await expect(page.getByText(/full link \(with decryption key\) is not stored/i)).toBeVisible({ timeout: 10000 });
    await expect(page.locator(QR_BUTTON)).toHaveCount(0);
    await expect(page.getByText('Regenerate link for QR')).toBeVisible();

    // Regenerate -> a new linkKey is sealed and the #lk URL is produced.
    await page.getByRole('button', { name: 'Regenerate Link' }).click();
    await expect.poll(async () => {
      const inputs = page.locator('input[readonly]');
      const n = await inputs.count();
      for (let i = 0; i < n; i++) {
        const v = await inputs.nth(i).inputValue();
        if (v.includes('#lk=')) return true;
      }
      return false;
    }, { timeout: 20000, message: 'a readonly field should contain the #lk fragment after regenerate' }).toBe(true);
    // And the main QR becomes scannable.
    await expect(page.locator(QR_BUTTON)).toBeVisible({ timeout: 10000 });
  });
});
