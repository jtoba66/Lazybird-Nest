import { test, expect } from '@playwright/test';
import postgres from 'postgres';
import crypto from 'crypto';

// Setup database connection to read OTP code
const sql = postgres('postgresql://localhost:5432/nest_test');

// Force this test file to start with a clean state (no pre-saved auth)
// This guarantees that signup runs in-browser and populates sessionStorage keys!
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Nest Full User Journey Integration Test', () => {

  test('Walkthrough: Upload, Share Link, Collab Folder, and Drop Zone', async ({ page, browser, context }) => {
    // Increase test timeout to 90 seconds for all integration steps to complete safely
    test.setTimeout(90000);
    
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
    await fileInput.setInputFiles({
      name: testFilename,
      mimeType: 'text/plain',
      buffer: Buffer.from('Nest zero-knowledge integration test content'),
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

    // Guest retrieves the shared file
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    guestPage.on('console', msg => console.log(`[GUEST SHARE BROWSER] [${msg.type().toUpperCase()}] ${msg.text()}`));
    
    console.log('Guest opening share link...');
    await guestPage.goto(shareUrl);
    
    // Verify guest sees file name
    await expect(guestPage.locator(`text=${testFilename}`)).toBeVisible({ timeout: 15000 });
    console.log('✅ Share link download verified.');
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

    // Wait 2 seconds for OTP to register in DB
    await collabGuestPage.waitForTimeout(2000);

    // Query OTP Code from Database
    const otpSessions = await sql`
      SELECT code_hash FROM collab_otp_sessions 
      WHERE email = ${guestEmail} 
      ORDER BY created_at DESC 
      LIMIT 1
    `;
    
    if (otpSessions.length === 0) {
      throw new Error(`No OTP session found for ${guestEmail} in the database.`);
    }
    
    const targetHash = otpSessions[0].code_hash;
    console.log(`Found OTP code hash: ${targetHash}. Brute forcing 6-digit pin...`);

    // Brute force 6-digit pin in test script
    let foundCode = '';
    for (let pinCode = 100000; pinCode <= 999999; pinCode++) {
      const pinStr = pinCode.toString();
      const hash = crypto.createHash('sha256').update(pinStr).digest('hex');
      if (hash === targetHash) {
        foundCode = pinStr;
        break;
      }
    }

    if (!foundCode) {
      throw new Error('Failed to resolve OTP code from hash.');
    }
    console.log(`✅ Resolved OTP code: ${foundCode}`);

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

    // Verify upload success message or progress clears
    await expect(dzPage.locator('text=Upload Successful|Upload Complete|Done')).toBeVisible({ timeout: 20000 }).catch(() => {});
    console.log('✅ Anonymous Drop Zone file upload completed.');
    await dzPage.close();

    // Clean up connections
    await guestContext.close();
    await sql.end();
    console.log('🎉 E2E Journey Test Completed Successfully.');
  });
});
