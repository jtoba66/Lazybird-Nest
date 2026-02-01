const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
    console.log('🚀 Starting Nest Full Journey Test (v2)...');

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // Define variables outside try block to be accessible in catch
    let page;

    try {
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        // --- STEP 1: SIGN UP ---
        const timestamp = Date.now();
        const testEmail = `testuser_${timestamp}@example.com`;
        const testPassword = 'Password123!';

        console.log(`\n📋 Step 1: Sign Up with ${testEmail}`);

        await page.goto('http://localhost:5173/signup', { waitUntil: 'networkidle0' });

        // Wait for form to exist
        await page.waitForSelector('form');

        // Fill form inputs
        console.log('   Filling email...');
        await page.type('input[type="email"]', testEmail);

        // Password fields
        // We expect at least 2 password fields (Password, Confirm)
        const passwordInputs = await page.$$('input[type="password"]');
        if (passwordInputs.length >= 2) {
            console.log('   Filling password and confirm password...');
            await passwordInputs[0].type(testPassword);
            await passwordInputs[1].type(testPassword);
        } else {
            // Maybe showPassword is toggled? fallback to just inputs
            console.log('   ⚠️ Could not find 2 password inputs, checking all inputs...');
            // This part is a bit custom, but standard flow should have them
        }

        // Check Terms Checkbox (CRITICAL)
        console.log('   Checking Terms checkbox...');
        await page.click('input#terms'); // ID from SignupPage.tsx

        await page.screenshot({ path: '1_signup_filled.png' });

        // Submit
        console.log('   Clicking Submit...');
        await page.click('button[type="submit"]');

        // --- STEP 2: VERIFY DASHBOARD ---
        console.log('\n📋 Step 2: Verifying Dashboard access...');

        // Wait for dashboard to load (look for "Nest" title)
        // Adjust timeout to allow for key generation simulation (can be slow)
        try {
            await page.waitForSelector('h1', { timeout: 20000 });
            const h1Text = await page.$eval('h1', el => el.innerText);
            console.log(`   Found Header: "${h1Text}"`);

            if (h1Text.includes('Nest')) {
                console.log('   ✅ Dashboard loaded successfully.');
            } else {
                // Maybe it's "Create your Nest" if redirect failed
                if (h1Text.includes('Create your Nest')) {
                    console.error('   ❌ Still on Signup page. Check screenshot.');
                    throw new Error('Signup failed to redirect');
                }
            }
        } catch (e) {
            console.log('   ⚠️ Timed out waiting for Dashboard header.');
            throw e;
        }

        await page.screenshot({ path: '2_dashboard.png' });

        // --- STEP 3: FILE UPLOAD ---
        console.log('\n📋 Step 3: File Upload...');

        // Locate hidden file input
        // Using waitForSelector ensuring it exists in DOM even if hidden
        const fileInput = await page.waitForSelector('input[type="file"]', { hidden: true });
        if (!fileInput) {
            throw new Error('Could not find file input on dashboard.');
        }

        const filePath = path.join(__dirname, 'test-upload.txt');
        console.log(`   Uploading ${filePath}...`);

        await fileInput.uploadFile(filePath);
        console.log('   File selected via hidden input.');

        // Wait for upload verification
        // Logic: Wait for the file name "test-upload.txt" to appear in the table text
        console.log('   Waiting for "test-upload.txt" to appear in UI...');

        try {
            await page.waitForFunction(
                (text) => document.body.innerText.includes(text),
                { timeout: 20000 }, // 20s timeout for upload/encrypt/refresh
                'test-upload.txt'
            );
            console.log('   ✅ File "test-upload.txt" found in list!');

        } catch (e) {
            console.error('   ❌ File did not appear in the list within timeout.');
            await page.screenshot({ path: 'error_upload_timeout.png' });
            throw new Error('Upload verification failed');
        }

        await page.screenshot({ path: '3_dashboard_with_file.png' });

        console.log('\n🎉 Test Completed Successfully.');

    } catch (error) {
        console.error('❌ Test failed:', error);
        if (page) await page.screenshot({ path: 'fatal_error.png' });
    } finally {
        await browser.close();
        console.log('Browser closed.');
    }
})();
