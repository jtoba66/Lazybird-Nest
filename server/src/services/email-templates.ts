/**
 * LazyBird Email Templates
 * Shared email service for Nest and Media Converter
 * 
 * Design Philosophy:
 * - Clean white card on soft gray background
 * - Professional typography (System UI fonts)
 * - Subtle status accents
 * - Clear hierarchy and call-to-actions
 */

// Theme Constants
const THEME = {
    colors: {
        bg: '#FFFFFF',          // Pure White
        card: '#FFFFFF',        // Pure White
        textMain: '#18181B',    // Zinc-900 (Main text)
        textMuted: '#4B5563',   // Gray-600 (Better for readability)
        border: '#F3F4F6',      // Zinc-100 (Subtle divide)
        primary: '#18181B',     // Black
    },
    spacing: {
        container: '40px 20px',
        card: '0px',            // No card padding needed for letter style
    }
};

/**
 * Base HTML Template Wrapper
 */
function wrapTemplate(content: string, title: string): string {
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
                background-color: ${THEME.colors.bg};
                margin: 0;
                padding: 40px 20px;
                line-height: 1.6;
                color: ${THEME.colors.textMain};
                -webkit-font-smoothing: antialiased;
            }
            .container {
                max-width: 540px;
                margin: 0 auto;
            }
            .logo {
                font-size: 20px;
                font-weight: 700;
                letter-spacing: -0.5px;
                color: ${THEME.colors.textMain};
                margin-bottom: 32px;
                display: block;
                text-decoration: none;
            }
            .h1 {
                font-size: 22px;
                font-weight: 600;
                margin: 0 0 16px 0;
                color: ${THEME.colors.textMain};
            }
            .p {
                font-size: 16px;
                margin: 0 0 24px 0;
                color: ${THEME.colors.textMuted};
            }
            .btn {
                display: inline-block;
                background-color: ${THEME.colors.primary};
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
                border-top: 1px solid ${THEME.colors.border};
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

/**
 * Password Reset Email
 */
export function passwordResetEmail(resetUrl: string) {
    const title = 'Reset Password';
    const content = `
        <h1 class="h1">Reset your Nest password</h1>
        <p class="p">Hi there,</p>
        <p class="p">We received a request to reset the password for your Nest account.</p>
        <p class="p">If you made this request, you can set a new password by clicking the link below:</p>
        <a href="${resetUrl}" class="btn">Reset Password</a>
        <p class="p" style="margin-top: 24px; font-size: 14px;">
            <i>This link will expire in 1 hour. If you didn't request this, you can safely ignore this email.</i>
        </p>
    `;
    return wrapTemplate(content, title);
}

/**
 * Password Changed Confirmation Email
 */
export function passwordChangedEmail() {
    const title = 'Password Changed';
    const content = `
        <h1 class="h1">Password changed successfully</h1>
        <p class="p">Hi there,</p>
        <p class="p">Your Nest account password has been successfully updated. You can now sign in with your new credentials.</p>
        <p class="p" style="font-size: 14px;"><i>If you didn't make this change, please contact our support team immediately.</i></p>
        <a href="${process.env.FRONTEND_URL || '#'}/login" class="btn">Sign In</a>
    `;
    return wrapTemplate(content, title);
}

/**
 * Welcome Email (Signup)
 */
export function welcomeEmail(email: string) {
    const title = 'Welcome to Nest';
    const content = `
        <h1 class="h1">Your private space is ready</h1>
        <p class="p">Your Nest account is ready. You can now start securing your files with end-to-end encryption.</p>
        <p class="p">Since only you hold the keys to your data, your privacy is guaranteed by design not just by promise.</p>
        <a href="${process.env.FRONTEND_URL || '#'}/dashboard" class="btn">Start Uploading</a>
        <p class="p" style="margin-top: 24px; font-size: 14px; font-style: italic;">
            Reminder: We never see your Master Key, please ensure it is backed up safely.
        </p>
    `;
    return wrapTemplate(content, title);
}

/**
 * Storage Quota Warning (90% full)
 */
export function storageQuotaWarningEmail(email: string, used: number, quota: number, tier: string) {
    const title = 'Storage Status';
    const content = `
        <h1 class="h1">Account Update: Storage status</h1>
        <p class="p">Hi there,</p>
        <p class="p">We're reaching out to let you know that your Nest account is nearing its storage limit (90% used).</p>
        <p class="p">To ensure your future uploads continue without interruption, you can review your files or check your plan options here:</p>
        <a href="${process.env.FRONTEND_URL || '#'}/settings" class="btn">View Storage Settings</a>
    `;
    return wrapTemplate(content, title);
}

/**
 * File Upload Success (Zero-Knowledge - no filename)
 */
export function fileUploadedEmail() {
    const title = 'File Secured';
    const content = `
        <h1 class="h1">Confirmation: File Secured</h1>
        <p class="p">Hi there,</p>
        <p class="p">Your recent upload was successful and has been secured to your private library.</p>
        <p class="p">As always, your data is protected by your personal keys and is only accessible by you.</p>
        <a href="${process.env.FRONTEND_URL?.split(',')[0].trim()}/folders" class="btn">View Your Files</a>
    `;
    return wrapTemplate(content, title);
}

/**
 * File Upload Failed
 */
export function fileUploadFailedEmail(filename: string) {
    const title = 'Upload Issue';
    const content = `
        <h1 class="h1">Issue securing your file</h1>
        <p class="p">Hi there,</p>
        <p class="p">An error occurred while trying to secure your file <strong>${filename}</strong> to our servers.</p>
        <p class="p">This usually happens due to a network timeout. Your data remains safe on your device, and you can try the upload again here:</p>
        <a href="${process.env.FRONTEND_URL?.split(',')[0].trim()}/dashboard" class="btn">Try Again</a>
    `;
    return wrapTemplate(content, title);
}

/**
 * Job Completed Email
 */
export function jobCompletedEmail(job: any) {
    const title = 'Job Completed Successfully';
    const content = `
        <h1 class="h1">Conversion Finished</h1>
        <p class="p">Hi there,</p>
        <p class="p">Your job <strong>${job.original_filename || 'File'}</strong> has been successfully processed.</p>
        <p class="p">You can download your converted file directly from your dashboard:</p>
        <a href="${process.env.FRONTEND_URL || '#'}/dashboard" class="btn">Download Result</a>
    `;
    return wrapTemplate(content, title);
}

/**
 * Job Failed Email
 */
export function jobFailedEmail(job: any) {
    const title = 'Job Failed';
    const content = `
        <h1 class="h1">Processing Error</h1>
        <p class="p">Hi there,</p>
        <p class="p">Unfortunately, your job <strong>${job.original_filename || 'File'}</strong> could not be processed.</p>
        <p class="p">This can happen with corrupted files or unsupported formats. You can view the details in your dashboard:</p>
        <a href="${process.env.FRONTEND_URL || '#'}/dashboard" class="btn">View Details</a>
    `;
    return wrapTemplate(content, title);
}

/**
 * Subscription Started Email
 */
export function subscriptionStartedEmail() {
    const title = 'Subscription Started';
    const content = `
        <h1 class="h1">Your 100GB Nest Pro account is active</h1>
        <p class="p">Hi there,</p>
        <p class="p">Your upgrade to Nest Pro is complete. Your account has been updated with the new 100GB storage quota.</p>
        <p class="p">You now have increased file limits and priority access to our support team if you ever need help.</p>
        <a href="${process.env.FRONTEND_URL || '#'}/dashboard" class="btn">Access Your Nest</a>
    `;
    return wrapTemplate(content, title);
}

/**
 * Subscription Canceled Email
 */
export function subscriptionCanceledEmail() {
    const title = 'Subscription Canceled';
    const content = `
        <h1 class="h1">Your Nest Pro subscription has been canceled</h1>
        <p class="p">Hi there,</p>
        <p class="p">Your Nest Pro subscription has been canceled. You'll continue to have access to Pro features until the end of your current billing period.</p>
        <p class="p">After that, your quota will return to the free 2GB limit.</p>
        <a href="${process.env.FRONTEND_URL || '#'}/pricing" class="btn">Manage Subscription</a>
    `;
    return wrapTemplate(content, title);
}

/**
 * Payment Failed Email
 */
export function paymentFailedEmail() {
    const title = 'Payment Failed';
    const content = `
        <h1 class="h1">Action Required: Payment issue with Nest Pro</h1>
        <p class="p">Hi there,</p>
        <p class="p">We were unable to process the latest payment for your Nest subscription.</p>
        <p class="p">To keep your 100GB quota and Pro features active, please update your payment method in your settings:</p>
        <a href="${process.env.FRONTEND_URL || '#'}/settings" class="btn">Update Payment Method</a>
        <p class="p" style="margin-top: 24px; font-size: 14px;">
            We'll try to process the payment again in a few days. If you have any questions, just reply to this email.
        </p>
    `;
    return wrapTemplate(content, title);
}

/**
 * Payment Received Email (Monthly Renewal)
 */
export function paymentReceivedEmail(amount: string) {
    const title = 'Payment Received';
    const content = `
        <h1 class="h1">Payment Received - Nest Pro</h1>
        <p class="p">Hi there,</p>
        <p class="p">Your monthly Nest Pro payment of ${amount} has been processed successfully.</p>
        <p class="p">Thank you for your continued support of private storage. You can manage your subscription and view your history in your settings:</p>
        <a href="${process.env.FRONTEND_URL || '#'}/settings" class="btn">Billing Settings</a>
    `;
    return wrapTemplate(content, title);
}

/**
 * Security Alert Email (New Login)
 */
export function securityAlertEmail() {
    const title = 'New Sign In';
    const content = `
        <h1 class="h1">New sign-in to your Nest account</h1>
        <p class="p">Hi there,</p>
        <p class="p">We detected a new sign-in to your account. If this was you, no action is needed.</p>
        <p class="p" style="font-size: 14px;"><i>If you don't recognize this activity, we recommend changing your password immediately to keep your account secure.</i></p>
        <a href="${process.env.FRONTEND_URL || '#'}/settings" class="btn">Security Settings</a>
    `;
    return wrapTemplate(content, title);
}

/**
 * Cancellation Farewell Email (with consequences)
 */
export function cancellationFarewellEmail() {
    const title = 'Subscription Status';
    const content = `
        <h1 class="h1">Your storage quota has changed</h1>
        <p class="p">Hi there,</p>
        <p class="p">Your Nest Pro subscription has ended and your storage quota has returned to 2GB.</p>
        <p class="p">If you have more than 2GB currently stored, you'll still be able to access your existing files, but new uploads will be paused until you are within the limit again.</p>
        <a href="${process.env.FRONTEND_URL || '#'}/pricing" class="btn">View Current Plan</a>
    `;
    return wrapTemplate(content, title);
}

/**
 * Share Link Weekly Digest
 */
export function shareLinkDigestEmail(totalDownloads: number, maxFileDownloads: number) {
    const title = 'Your Files are Popular';
    const content = `
        <h1 class="h1">Weekly Share Summary</h1>
        <p class="p">Hi there,</p>
        <p class="p">Your shared files were downloaded <strong>${totalDownloads}</strong> times this week.</p>
        <p class="p">Your most popular file received <strong>${maxFileDownloads}</strong> downloads. You can manage your active links and see more details in your dashboard:</p>
        <a href="${process.env.FRONTEND_URL || '#'}/shared" class="btn">Manage Shared Links</a>
    `;
    return wrapTemplate(content, title);
}

/**
 * Account Inactive Nudge
 */
export function accountInactiveEmail() {
    const title = 'Following up';
    const content = `
        <h1 class="h1">Following up from Nest</h1>
        <p class="p">Hi there,</p>
        <p class="p">It's been a while since we've seen you. Just a reminder that your encrypted files are safe and waiting for you.</p>
        <p class="p">We're always here if you need to secure more of your digital life.</p>
        <a href="${process.env.FRONTEND_URL || '#'}/login" class="btn">Sign In</a>
    `;
    return wrapTemplate(content, title);
}
