import { sendEmail } from '../services/email';

/**
 * Proposed Minimalist Template Wrapper
 */
function wrapProposedTemplate(content: string, title: string): string {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                background-color: #ffffff;
                margin: 0;
                padding: 40px 20px;
                line-height: 1.6;
                color: #18181b;
            }
            .container {
                max-width: 540px;
                margin: 0 auto;
            }
            .logo {
                font-size: 20px;
                font-weight: 700;
                letter-spacing: -0.5px;
                color: #18181b;
                margin-bottom: 32px;
                display: block;
                text-decoration: none;
            }
            .h1 {
                font-size: 22px;
                font-weight: 600;
                margin: 0 0 16px 0;
                color: #18181b;
            }
            .p {
                font-size: 16px;
                margin: 0 0 24px 0;
                color: #4b5563;
            }
            .btn {
                display: inline-block;
                background-color: #18181b;
                color: #ffffff !important;
                padding: 12px 24px;
                border-radius: 6px;
                text-decoration: none;
                font-weight: 500;
                font-size: 15px;
                margin: 10px 0;
            }
            .footer {
                margin-top: 48px;
                padding-top: 24px;
                border-top: 1px solid #f3f4f6;
                font-size: 13px;
                color: #9ca3af;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <a href="https://lazybird.io" class="logo">Nest</a>
            ${content}
            <div class="footer">
                <p>© ${new Date().getFullYear()} Nest • Secure, Zero-Knowledge Storage</p>
                <p>Sent from admin@lazybird.io</p>
            </div>
        </div>
    </body>
    </html>
    `;
}

async function sendTest(name: string, to: string, subject: string, content: string) {
    const html = wrapProposedTemplate(content, subject);
    console.log(`[Test-Remaining] Sending ${name} to: ${to}`);
    const success = await sendEmail({ to, subject, html });
    if (!success) console.error(`[Test-Remaining] ❌ Failed to send ${name}`);
    return success;
}

async function main() {
    const email = 'upsellintegrated@gmail.com';
    
    // 5. File Secured
    const secured = `
        <h1 class="h1">Your file is now encrypted and stored</h1>
        <p class="p">Hi there,</p>
        <p class="p">Your recent upload was successful. Your file is now fully encrypted and stored securely on the decentralized network.</p>
        <p class="p">Since only you hold the decryption keys, your data is safe and private by design.</p>
        <a href="https://nest.lazybird.io" class="btn">View Your Library</a>
    `;

    // 6. File Issue
    const issue = `
        <h1 class="h1">Issue securing your file</h1>
        <p class="p">Hi there,</p>
        <p class="p">An error occurred while trying to secure your file to our servers.</p>
        <p class="p">This usually happens due to a network timeout. Your data remains safe on your device, and you can try the upload again here:</p>
        <a href="https://nest.lazybird.io" class="btn">Try Again</a>
    `;

    // 7. Storage Quota Warning
    const quota = `
        <h1 class="h1">Your Nest storage is almost full</h1>
        <p class="p">Hi there,</p>
        <p class="p">You have used over 90% of your current storage quota.</p>
        <p class="p">To continue uploading files without interruption, you may want to upgrade your plan or remove some older files to free up space.</p>
        <a href="https://nest.lazybird.io/settings" class="btn">Manage Storage</a>
    `;

    // 8. Receipt
    const receipt = `
        <h1 class="h1">Payment Received - Nest Pro</h1>
        <p class="p">Hi there,</p>
        <p class="p">Your monthly Nest Pro payment of $4.99 has been processed successfully.</p>
        <p class="p">Thank you for your continued support of private storage. You can manage your subscription and view your history in your settings:</p>
        <a href="https://nest.lazybird.io/settings" class="btn">Billing Settings</a>
    `;

    // 9. Canceled
    const canceled = `
        <h1 class="h1">Your Nest Pro subscription has been canceled</h1>
        <p class="p">Hi there,</p>
        <p class="p">Your Nest Pro subscription has been canceled. You'll continue to have access to Pro features until the end of your current billing period.</p>
        <p class="p">After that, your quota will return to the free 2GB limit.</p>
        <a href="https://nest.lazybird.io/pricing" class="btn">Manage Subscription</a>
    `;

    // 10. Farewell
    const farewell = `
        <h1 class="h1">Your storage quota has changed</h1>
        <p class="p">Hi there,</p>
        <p class="p">Your Nest Pro subscription has ended and your storage quota has returned to 2GB.</p>
        <p class="p">If you have more than 2GB currently stored, you'll still be able to access your existing files, but new uploads will be paused until you are within the limit again.</p>
        <a href="https://nest.lazybird.io/pricing" class="btn">View Current Plan</a>
    `;

    // 11. Password Updated
    const pwUpdated = `
        <h1 class="h1">Password changed successfully</h1>
        <p class="p">Hi there,</p>
        <p class="p">Your Nest account password has been successfully updated. You can now sign in with your new credentials.</p>
        <p class="p" style="font-size: 14px;"><i>If you didn't make this change, please contact our support team immediately.</i></p>
        <a href="https://nest.lazybird.io/login" class="btn">Sign In</a>
    `;

    // 12. Security Alert
    const signin = `
        <h1 class="h1">New sign-in to your Nest account</h1>
        <p class="p">Hi there,</p>
        <p class="p">We detected a new sign-in to your account. If this was you, no action is needed.</p>
        <p class="p" style="font-size: 14px;"><i>If you don't recognize this activity, we recommend changing your password immediately to keep your account secure.</i></p>
        <a href="https://nest.lazybird.io/settings" class="btn">Security Settings</a>
    `;

    // 13. Weekly Digest
    const digest = `
        <h1 class="h1">Your Weekly Share Summary</h1>
        <p class="p">Hi there,</p>
        <p class="p">Your shared files were downloaded <strong>42</strong> times this week.</p>
        <p class="p">Your most popular file received <strong>12</strong> downloads. You can manage your active links and see more details in your dashboard:</p>
        <a href="https://nest.lazybird.io/shared" class="btn">Manage Shared Links</a>
    `;

    // 14. Inactive
    const inactive = `
        <h1 class="h1">Following up from Nest</h1>
        <p class="p">Hi there,</p>
        <p class="p">It's been a while since we've seen you. Just a reminder that your encrypted files are safe and waiting for you.</p>
        <p class="p">We're always here if you need to secure more of your digital life.</p>
        <a href="https://nest.lazybird.io/login" class="btn">Sign In</a>
    `;

    await sendTest('File Secured', email, 'Your file is now encrypted and stored', secured);
    await sendTest('File Issue', email, 'Issue securing your file', issue);
    await sendTest('Quota Warning', email, 'Your Nest storage is almost full', quota);
    await sendTest('Receipt', email, 'Payment Received - Nest Pro', receipt);
    await sendTest('Canceled', email, 'Your Nest Pro subscription has been canceled', canceled);
    await sendTest('Farewell', email, 'Your storage quota has changed', farewell);
    await sendTest('PW Updated', email, 'Password changed successfully', pwUpdated);
    await sendTest('Sign-In Alert', email, 'New sign-in to your Nest account', signin);
    await sendTest('Weekly Digest', email, 'Your Weekly Share Summary', digest);
    await sendTest('Inactive', email, 'Following up from Nest', inactive);

    console.log('[Test-Remaining] ✅ All 10 remaining templates triggered.');
    process.exit(0);
}

main();
