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
    console.log(`[Test-Suite] Sending ${name} to: ${to}`);
    const success = await sendEmail({ to, subject, html });
    if (!success) console.error(`[Test-Suite] ❌ Failed to send ${name}`);
    return success;
}

async function main() {
    const email = 'upsellintegrated@gmail.com';
    
    // 1. Welcome
    const welcome = `
        <h1 class="h1">Your private space is ready</h1>
        <p class="p">Your Nest account is ready. You can now start securing your files with end-to-end encryption.</p>
        <p class="p">Since only you hold the keys to your data, your privacy is guaranteed by design not just by promise.</p>
        <a href="https://nest.lazybird.io" class="btn">Start Uploading</a>
        <p class="p" style="margin-top: 24px; font-size: 14px; font-style: italic;">
            Reminder: We never see your Master Key, please ensure it is backed up safely.
        </p>
    `;

    // 2. Pro Subscription Started
    const pro = `
        <h1 class="h1">Your 100GB Nest Pro account is active</h1>
        <p class="p">Hi there,</p>
        <p class="p">Your upgrade to Nest Pro is complete. Your account has been updated with the new 100GB storage quota.</p>
        <p class="p">You now have increased file limits and priority access to our support team if you ever need help.</p>
        <a href="https://nest.lazybird.io" class="btn">Access Your Nest</a>
    `;

    // 3. Password Reset
    const reset = `
        <h1 class="h1">Reset your Nest password</h1>
        <p class="p">Hi there,</p>
        <p class="p">We received a request to reset the password for your Nest account.</p>
        <p class="p">If you made this request, you can set a new password by clicking the link below:</p>
        <a href="https://nest.lazybird.io/reset-password?token=test-token" class="btn">Reset Password</a>
        <p class="p" style="margin-top: 24px; font-size: 14px;">
            *This link will expire in 60 minutes. If you didn't request this, you can safely ignore this email.*
        </p>
    `;

    // 4. Payment Failed
    const failed = `
        <h1 class="h1">Action Required: Payment issue with Nest Pro</h1>
        <p class="p">Hi there,</p>
        <p class="p">We were unable to process the latest payment for your Nest subscription.</p>
        <p class="p">To keep your 100GB quota and Pro features active, please update your payment method in your settings:</p>
        <a href="https://nest.lazybird.io/settings" class="btn">Update Payment Method</a>
        <p class="p" style="margin-top: 24px; font-size: 14px;">
            We'll try to process the payment again in a few days. If you have any questions, just reply to this email.
        </p>
    `;

    await sendTest('Welcome', email, 'Your private space is ready', welcome);
    await sendTest('Pro Upgrade', email, 'Your 100GB Nest Pro account is active', pro);
    await sendTest('Password Reset', email, 'Reset your Nest password', reset);
    await sendTest('Payment Failed', email, 'Action Required: Payment issue with Nest Pro', failed);

    console.log('[Test-Suite] ✅ All four templates triggered.');
    process.exit(0);
}

main();
