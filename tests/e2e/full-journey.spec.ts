import { test, expect } from '@playwright/test';
import postgres from 'postgres';
import fs from 'fs';

// DB handle kept for collab assertions; the OTP itself now comes from the real email (MailDev).
const sql = postgres('postgresql://localhost:5432/nest_test');

// MailDev REST API — lets us assert mail was actually generated, sent over SMTP, and delivered.
const MAILDEV_API = 'http://localhost:1080';

/** Poll MailDev for the most recent message to `to` and return the 6-digit OTP from its subject. */
async function fetchOtpFromMail(to: string, timeoutMs = 15000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILDEV_API}/email`);
    const messages: Array<{ subject: string; to: Array<{ address: string }> }> = await res.json();
    const match = messages
      .filter(m => m.to?.some(t => t.address.toLowerCase() === to.toLowerCase()))
      .reverse()
      .find(m => /\b\d{6}\b/.test(m.subject));
    if (match) {
      const code = match.subject.match(/\b(\d{6})\b/);
      if (code) return code[1];
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`No OTP email for ${to} arrived in MailDev within ${timeoutMs}ms`);
}

// Force this test file to start with a clean state (no pre-saved auth)
// This guarantees that signup runs in-browser and populates sessionStorage keys!
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Nest Full User Journey Integration Test', () => {

  test('Walkthrough: Upload, Share Link, Collab Folder, and Drop Zone', async ({ page, browser, context }) => {
    // Increase test timeout to 90 seconds for all integration steps to complete safely
    test.setTimeout(120000);
    
    console.log('🏁 Starting E2E Journey Test...');

    // Print all browser console logs for debugging
    page.on('console', msg => console.log(`[HOST BROWSER] [${msg.type().toUpperCase()}] ${msg.text()}`));

    // Grant clipboard permissions so we can read copied share links
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // ----------------------------------------------------
    // STEP 0: Sign Up to populate sessionStorage keys
    // ----------------------------------------------------
    console.log('Step 0: Signing up a new user...');
    await page.goto('/signup');
    
    const registerTab = page.locator('button:has-text("Register")');
    if (await registerTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await registerTab.click();
    }

    const hostEmail = `journey_host_${Date.now()}@test.local`;
    await page.fill('input[type="email"]', hostEmail);
    await page.locator('input[type="password"]').nth(0).fill('Password123!');
    await page.locator('input[type="password"]').nth(1).fill('Password123!');
    await page.locator('input[type="checkbox"]').click();
    await page.getByRole('button', { name: 'Create Account' }).click();

    // Wait until dashboard is active
    await expect(page.locator('h1:has-text("Nest")')).toBeVisible({ timeout: 25000 });
    console.log(`✅ Host user signed up and logged in: ${hostEmail}`);

    // ----------------------------------------------------
    // STEP 1: Host Uploads a File
    // ----------------------------------------------------
    console.log('Step 1: Uploading a private file...');
    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached({ timeout: 10000 });

    const testFilename = `journey-test-${Date.now()}.txt`;
    const SHARED_CONTENT = 'Nest zero-knowledge integration test content — share marker 67890';
    await fileInput.setInputFiles({
      name: testFilename,
      mimeType: 'text/plain',
      buffer: Buffer.from(SHARED_CONTENT),
    });

    // Wait for the specific file row in the table to be visible
    const fileRow = page.locator('tr').filter({ hasText: testFilename });
    await expect(fileRow).toBeVisible({ timeout: 25000 });
    console.log('✅ File uploaded and visible in table.');

    // ----------------------------------------------------
    // STEP 2: Host Shares the File
    // ----------------------------------------------------
    console.log('Step 2: Generating Share Link...');
    await fileRow.hover();
    await fileRow.locator('button[title="Share"]').click();

    // The link is either copied to the clipboard or shown in a modal if clipboard is blocked.
    let shareUrl = '';
    const successModalInput = page.locator('input[type="text"]').filter({ hasText: 'http' }).first();
    const successModalInput2 = page.locator('input[readonly]').first();

    await page.waitForTimeout(1000); // Wait for modal/clipboard action

    if (await successModalInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      shareUrl = await successModalInput.inputValue();
      console.log('Got link from successModalInput text filter');
      await page.keyboard.press('Escape');
    } else if (await successModalInput2.isVisible({ timeout: 2000 }).catch(() => false)) {
      shareUrl = await successModalInput2.inputValue();
      console.log('Got link from successModalInput2 readonly');
      await page.keyboard.press('Escape');
    } else {
      shareUrl = await page.evaluate(() => navigator.clipboard.readText());
      console.log('Got link from clipboard');
    }

    console.log(`✅ Share URL: ${shareUrl}`);
    expect(shareUrl).toContain('/s/');

    // Guest retrieves the shared file — and actually downloads + decrypts the bytes.
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    guestPage.on('console', msg => console.log(`[GUEST SHARE BROWSER] [${msg.type().toUpperCase()}] ${msg.text()}`));

    console.log('Guest opening share link...');
    await guestPage.goto(shareUrl);

    // Verify guest sees file name (metadata decrypts from the URL key fragment)
    await expect(guestPage.locator(`text=${testFilename}`)).toBeVisible({ timeout: 15000 });

    // The real prod-bug path: anonymous guest fetches the ciphertext from local storage, decrypts
    // it in-browser (the WASM init that the "Library not initialised" fix guards), then triggers an
    // <a download> of the plaintext. Read that download and assert it equals the original content.
    const shareDownloadPromise = guestPage.waitForEvent('download', { timeout: 30000 });
    await guestPage.getByRole('button', { name: /Download File/i }).click();
    const shareDownload = await shareDownloadPromise;
    const sharePath = await shareDownload.path();
    expect(fs.readFileSync(sharePath, 'utf-8')).toBe(SHARED_CONTENT);
    console.log('✅ Share link download + decrypt verified (real bytes).');
    await guestPage.close();

    // ----------------------------------------------------
    // STEP 3: Host Creates a Collab Folder with Guest Access
    // ----------------------------------------------------
    console.log('Step 3: Setting up Collab Folder...');
    await page.goto('/shared');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 10000 });

    // Click "New Collab Folder" (the actual button text in UI)
    await page.getByRole('button', { name: 'New Collab Folder' }).click();

    // Enter collab folder name
    const folderNameInput = page.locator('input[placeholder="e.g. Acme Marketing Sync"]');
    await expect(folderNameInput).toBeVisible({ timeout: 5000 });
    await folderNameInput.fill('Journey Collab Folder');

    // Add guest email
    const guestEmail = `collab_guest_${Date.now()}@test.local`;
    const emailInput = page.locator('input[placeholder="Enter guest email and press enter"]');
    await emailInput.fill(guestEmail);
    await page.getByRole('button', { name: 'Add' }).click();

    // Click Create inside the modal form specifically
    await page.locator('form button[type="submit"]').click();

    // Get Collab Folder link
    const collabLinkInput = page.locator('input[readonly]').first();
    await expect(collabLinkInput).toBeVisible({ timeout: 15000 });
    const collabUrl = await collabLinkInput.inputValue();
    console.log(`✅ Collab Folder URL generated: ${collabUrl}`);
    
    // Close Modal
    await page.keyboard.press('Escape');

    // Guest accessing Collab Folder
    const collabGuestPage = await guestContext.newPage();
    collabGuestPage.on('console', msg => console.log(`[GUEST COLLAB BROWSER] [${msg.type().toUpperCase()}] ${msg.text()}`));
    await collabGuestPage.goto(collabUrl);

    // Verify Guest Entry Portal
    const guestEmailInput = collabGuestPage.locator('input[type="email"]');
    await expect(guestEmailInput).toBeVisible({ timeout: 10000 });
    await guestEmailInput.fill(guestEmail);
    await collabGuestPage.getByRole('button', { name: 'Request Access Key' }).click();

    // Read the OTP from the REAL email delivered to MailDev. This proves the full mail path:
    // the server generated the code, sent it over SMTP, and it was delivered to the guest's inbox.
    const foundCode = await fetchOtpFromMail(guestEmail);
    console.log(`✅ OTP received via email (MailDev): ${foundCode}`);

    // Fill OTP inputs
    const otpInputs = collabGuestPage.locator('input[type="text"]');
    const count = await otpInputs.count();
    if (count === 6) {
      for (let i = 0; i < 6; i++) {
        await otpInputs.nth(i).fill(foundCode[i]);
      }
    } else {
      const singleOtpInput = collabGuestPage.locator('input[placeholder*="code" i], input[type="text"]').first();
      await singleOtpInput.fill(foundCode);
    }

    await collabGuestPage.getByRole('button', { name: /Verify/i }).first().click();

    // Verify guest successfully entered collab portal
    await expect(collabGuestPage.locator('text=Nest Portal')).toBeVisible({ timeout: 20000 });
    console.log('✅ Guest OTP login verification verified.');
    await collabGuestPage.close();

    // ----------------------------------------------------
    // STEP 4: Host Creates a Drop Zone & Guest Uploads
    // ----------------------------------------------------
    console.log('Step 4: Setting up Drop Zone...');
    await page.goto('/shared');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Create Drop Zone' }).click();

    const dzNameInput = page.locator('input[placeholder="e.g. Acme Project Assets"]').first();
    await expect(dzNameInput).toBeVisible({ timeout: 5000 });
    await dzNameInput.fill('Journey Drop Zone');

    // Click Create inside the modal form specifically
    await page.locator('form button[type="submit"]').click();

    const dzLinkInput = page.locator('input[readonly]').first();
    await expect(dzLinkInput).toBeVisible({ timeout: 10000 });
    const dzUrl = await dzLinkInput.inputValue();
    console.log(`✅ Drop Zone URL generated: ${dzUrl}`);

    // Close Modal
    await page.keyboard.press('Escape');

    // Guest uploads anonymous file
    const dzPage = await guestContext.newPage();
    dzPage.on('console', msg => console.log(`[GUEST DROPZONE BROWSER] [${msg.type().toUpperCase()}] ${msg.text()}`));
    await dzPage.goto(dzUrl);

    const dzFileInput = dzPage.locator('input[type="file"]').first();
    await expect(dzFileInput).toBeAttached({ timeout: 10000 });

    const dzFilename = `dropzone-test-${Date.now()}.txt`;
    await dzFileInput.setInputFiles({
      name: dzFilename,
      mimeType: 'text/plain',
      buffer: Buffer.from('Anonymous Drop Zone test content'),
    });

    // Real assertion (previously a no-op: `text=` ignores `|` alternation and `.catch` swallowed
    // failures). The drop-zone shows this toast only after the file is encrypted (crypto_box_seal
    // to the host's public key) and the ciphertext is accepted by the server.
    await expect(dzPage.getByText('File received securely!')).toBeVisible({ timeout: 25000 });
    console.log('✅ Anonymous Drop Zone file upload verified.');
    await dzPage.close();

    // Clean up connections
    await guestContext.close();
    await sql.end();
    console.log('🎉 E2E Journey Test Completed Successfully.');
  });
});
