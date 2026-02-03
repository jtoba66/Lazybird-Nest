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
        bg: '#F3F4F6',          // Zinc-100
        card: '#FFFFFF',        // White
        textMain: '#18181B',    // Zinc-900
        textMuted: '#71717A',   // Zinc-500
        border: '#E4E4E7',      // Zinc-200
        primary: '#000000',     // Black
        accent: '#768A96',      // Nest primary (Slate Blue)
        success: '#10B981',     // Emerald-500
        error: '#EF4444',       // Red-500
    },
    spacing: {
        container: '40px 20px',
        card: '40px',
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
                padding: 0;
                line-height: 1.6;
                color: ${THEME.colors.textMain};
                -webkit-font-smoothing: antialiased;
            }
            .wrapper {
                width: 100%;
                background-color: ${THEME.colors.bg};
                padding: ${THEME.spacing.container};
            }
            .container {
                max-width: 540px;
                margin: 0 auto;
                background-color: ${THEME.colors.card};
                border-radius: 16px;
                border: 1px solid ${THEME.colors.border};
                box-shadow: 0 2px 4px rgba(0,0,0,0.02);
                overflow: hidden;
            }
            .header {
                padding: 40px 40px 20px 40px;
                text-align: center;
            }
            .logo {
                font-size: 24px;
                font-weight: 800;
                letter-spacing: -1px;
                color: ${THEME.colors.textMain};
                text-decoration: none;
                display: inline-block;
                margin-bottom: 8px;
            }
            .content {
                padding: 10px 40px 40px 40px;
            }
            .h1 {
                font-size: 20px;
                font-weight: 600;
                margin: 0 0 16px 0;
                color: ${THEME.colors.textMain};
            }
            .p {
                font-size: 15px;
                margin: 0 0 24px 0;
                color: ${THEME.colors.textMuted};
                line-height: 1.6;
            }
            .btn {
                display: inline-block;
                background-color: ${THEME.colors.primary};
                color: #ffffff;
                padding: 12px 28px;
                border-radius: 8px;
                text-decoration: none;
                font-weight: 500;
                font-size: 14px;
                margin: 10px 0;
                text-align: center;
            }
            .btn:hover { opacity: 0.9; }
            .status-badge {
                display: inline-block;
                padding: 6px 12px;
                border-radius: 99px;
                font-size: 12px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .status-success { background: #ECFDF5; color: ${THEME.colors.success}; }
            .status-error { background: #FEF2F2; color: ${THEME.colors.error}; }
            
            .footer {
                padding: 30px;
                text-align: center;
                font-size: 13px;
                color: ${THEME.colors.textMuted};
                border-top: 1px solid ${THEME.colors.border};
                background-color: #FAFAFA;
            }
        </style>
    </head>
    <body>
        <div class="wrapper">
            <div class="container">
                <div class="header">
                    <div class="logo">Nest</div>
                </div>
                <div class="content">
                    ${content}
                </div>
                <div class="footer">
                    <p style="margin: 0 0 8px 0;">© ${new Date().getFullYear()} Nest</p>
                    <p style="margin: 0;">Secure • Private • Zero-Knowledge</p>
                </div>
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
        <h1 class="h1" style="text-align: center;">Reset your password</h1>
        <p class="p" style="text-align: center;">
            We received a request to reset the password for your Nest account. If this was you, click the button below to proceed.
        </p>

        <div style="text-align: center; margin: 32px 0;">
            <a href="${resetUrl}" class="btn">Reset Password</a>
        </div>

        <p class="p" style="text-align: center; font-size: 13px;">
            This link will expire in 1 hour. If you didn't request this, you can safely ignore this email.
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
        <h1 class="h1" style="text-align: center;">Password Updated</h1>
        <p class="p" style="text-align: center;">
            Your Nest account password has been successfully changed. You can now log in with your new credentials.
        </p>

        <div style="text-align: center; margin-top: 32px;">
            <a href="${process.env.FRONTEND_URL || '#'}/login" class="btn">Log In</a>
        </div>

        <p class="p" style="text-align: center; font-size: 13px; margin-top: 16px;">
            If you didn't make this change, please contact support immediately.
        </p>
    `;
    return wrapTemplate(content, title);
}

/**
 * Welcome Email (Signup)
 */
export function welcomeEmail(email: string) {
    const title = 'Welcome to Nest';
    const content = `
        <h1 class="h1" style="text-align: center;">Welcome to your private nest</h1>
        <p class="p" style="text-align: center;">
            We're excited to have you on board! Your files are now protected with zero-knowledge encryption.
        </p>

        <div style="background-color: #FAFAFA; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
            <p style="margin: 0; font-weight: 600; font-size: 14px; color: ${THEME.colors.textMain};">Your Account</p>
            <p style="margin: 4px 0 0 0; color: ${THEME.colors.textMuted};">${email}</p>
        </div>

        <div style="text-align: center; margin-top: 32px;">
            <a href="${process.env.FRONTEND_URL || '#'}/" class="btn">Start Uploading</a>
        </div>

        <p class="p" style="text-align: center; font-size: 13px; margin-top: 24px;">
            <strong>Zero-Knowledge Encryption:</strong> Your encryption keys never leave your device. 
            Even we can't access your files.
        </p>
    `;
    return wrapTemplate(content, title);
}

/**
 * Storage Quota Warning (90% full)
 */
export function storageQuotaWarningEmail(email: string, used: number, quota: number, tier: string) {
    const title = 'Storage Almost Full';
    const percentage = Math.round((used / quota) * 100);
    const usedGB = (used / (1024 * 1024 * 1024)).toFixed(2);
    const quotaGB = (quota / (1024 * 1024 * 1024)).toFixed(2);

    const content = `
        <h1 class="h1" style="text-align: center;">Storage Running Low</h1>
        <p class="p" style="text-align: center;">
            Your Nest storage is ${percentage}% full. Consider upgrading or cleaning up files to continue uploading.
        </p>

        <div style="background-color: #FEF2F2; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0; border: 1px solid #FEE2E2;">
            <p style="margin: 0; font-weight: 600; font-size: 32px; color: ${THEME.colors.error};">${usedGB} GB / ${quotaGB} GB</p>
            <p style="margin: 8px 0 0 0; color: ${THEME.colors.textMuted}; font-size: 14px;">Current Plan: ${tier.toUpperCase()}</p>
        </div>

        ${tier === 'free' ? `
        <div style="text-align: center; margin-top: 32px;">
            <a href="${process.env.FRONTEND_URL || '#'}/pricing" class="btn">Upgrade to Pro</a>
        </div>
        <p class="p" style="text-align: center; font-size: 13px; margin-top: 16px;">
            Pro plan includes 100GB storage for just $4.99/month
        </p>
        ` : `
        <div style="text-align: center; margin-top: 32px;">
            <a href="${process.env.FRONTEND_URL || '#'}/" class="btn">Manage Storage</a>
        </div>
        `}
    `;
    return wrapTemplate(content, title);
}

/**
 * File Upload Success (Zero-Knowledge - no filename)
 */
export function fileUploadedEmail() {
    const title = 'File Secured';
    const content = `
        <div style="text-align: center; margin-bottom: 24px;">
            <span class="status-badge status-success">Secured</span>
        </div>
        <h1 class="h1" style="text-align: center;">Your file is now encrypted and stored</h1>
        <p class="p" style="text-align: center;">
            We'd tell you the name, but we genuinely don't know it. That's zero-knowledge encryption working exactly as intended.
        </p>

        <div style="text-align: center; margin-top: 32px;">
            <a href="${process.env.FRONTEND_URL?.split(',')[0].trim()}/folders" class="btn">View Files</a>
        </div>

        <p class="p" style="text-align: center; margin-top: 24px; font-size: 13px;">
            Only you hold the keys. Your data is safe on the decentralized network.
        </p>
    `;
    return wrapTemplate(content, title);
}

/**
 * File Upload Failed
 */
export function fileUploadFailedEmail(filename: string) {
    const title = 'Upload Issue';
    const content = `
        <div style="text-align: center; margin-bottom: 24px;">
            <span class="status-badge status-warning" style="background-color: #FEE2E2; color: #EF4444;">Failed</span>
        </div>
        <h1 class="h1" style="text-align: center;">Issue securing your file</h1>
        <p class="p" style="text-align: center;">
            An error occurred while trying to secure your file <strong>${filename}</strong> to our servers.
        </p>

        <div style="text-align: center; margin-top: 32px;">
            <a href="${process.env.FRONTEND_URL?.split(',')[0].trim()}/dashboard" class="btn">Try Again</a>
        </div>

        <p class="p" style="text-align: center; margin-top: 24px; font-size: 13px;">
            This usually happens due to a network timeout. Your data remains safe on your device.
        </p>
    `;
    return wrapTemplate(content, title);
}

/**
 * Job Completed Email
 */
export function jobCompletedEmail(job: any) {
    const title = 'Job Completed Successfully';
    const content = `
        <div style="text-align: center; margin-bottom: 24px;">
            <span class="status-badge status-success">Completed</span>
        </div>
        <h1 class="h1" style="text-align: center;">Conversion Finished</h1>
        <p class="p" style="text-align: center;">
            Your job <strong>${job.original_filename || 'File'}</strong> has been successfully processed.
        </p>

        <div style="text-align: center; margin-top: 32px;">
            <a href="${process.env.FRONTEND_URL || '#'}/" class="btn">Download Result</a>
        </div>
    `;
    return wrapTemplate(content, title);
}

/**
 * Job Failed Email
 */
export function jobFailedEmail(job: any) {
    const title = 'Job Failed';
    const content = `
        <div style="text-align: center; margin-bottom: 24px;">
            <span class="status-badge status-error">Failed</span>
        </div>
        <h1 class="h1" style="text-align: center;">Processing Error</h1>
        <p class="p" style="text-align: center;">
            Unfortunately, your job <strong>${job.original_filename || 'File'}</strong> could not be processed.
        </p>

        <div style="text-align: center; margin-top: 32px;">
            <a href="${process.env.FRONTEND_URL || '#'}/" class="btn">View Details</a>
        </div>
    `;
    return wrapTemplate(content, title);
}

/**
 * Subscription Started Email
 */
export function subscriptionStartedEmail() {
    const title = 'Subscription Started';
    const content = `
        <div style="text-align: center; margin-bottom: 24px;">
            <span class="status-badge status-success">Pro Plan Active</span>
        </div>
        <h1 class="h1" style="text-align: center;">Upgrade Successful</h1>
        <p class="p" style="text-align: center;">
            Thank you for upgrading to Nest Pro. Your 100GB storage quota is now active.
        </p>

        <div style="background-color: #FAFAFA; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
            <p style="margin: 0; font-weight: 600; font-size: 14px; color: ${THEME.colors.textMain};">Included with Pro</p>
            <p style="margin: 4px 0 0 0; color: ${THEME.colors.textMuted};">100GB Secure Storage • 10GB File Limit • Priority Support</p>
        </div>

        <div style="text-align: center; margin-top: 32px;">
            <a href="${process.env.FRONTEND_URL || '#'}/" class="btn">Start Uploading</a>
        </div>
    `;
    return wrapTemplate(content, title);
}

/**
 * Subscription Canceled Email
 */
export function subscriptionCanceledEmail() {
    const title = 'Subscription Canceled';
    const content = `
        <h1 class="h1" style="text-align: center;">Subscription Canceled</h1>
        <p class="p" style="text-align: center;">
            Your Nest Pro subscription has been canceled. You will still have access to Pro features until the end of your current billing period.
        </p>

        <div style="background-color: #FAFAFA; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
            <p style="margin: 0; font-size: 14px; color: ${THEME.colors.textMuted};">
                After the current period ends, your quota will return to 2GB.
            </p>
        </div>

        <div style="text-align: center; margin-top: 32px;">
            <a href="${process.env.FRONTEND_URL || '#'}/pricing" class="btn">Renew Subscription</a>
        </div>
    `;
    return wrapTemplate(content, title);
}

/**
 * Payment Failed Email
 */
export function paymentFailedEmail() {
    const title = 'Payment Failed';
    const content = `
        <div style="text-align: center; margin-bottom: 24px;">
            <span class="status-badge status-error">Action Required</span>
        </div>
        <h1 class="h1" style="text-align: center;">Problem with Payment</h1>
        <p class="p" style="text-align: center;">
            We were unable to process the recurring payment for your Nest Pro subscription. Please update your payment method to avoid any service interruption.
        </p>

        <div style="text-align: center; margin-top: 32px;">
            <a href="${process.env.FRONTEND_URL || '#'}/settings" class="btn">Update Billing</a>
        </div>

        <p class="p" style="text-align: center; font-size: 13px; margin-top: 24px;">
            We will attempt the payment again in a few days.
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
        <div style="text-align: center; margin-bottom: 24px;">
            <span class="status-badge status-success">Paid</span>
        </div>
        <h1 class="h1" style="text-align: center;">Payment Received</h1>
        <p class="p" style="text-align: center;">
            Your monthly Nest Pro payment of ${amount} has been processed successfully. Thank you for your continued support.
        </p>

        <div style="background-color: #FAFAFA; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
            <p style="margin: 0; font-weight: 600; font-size: 14px; color: ${THEME.colors.textMain};">Next billing date</p>
            <p style="margin: 4px 0 0 0; color: ${THEME.colors.textMuted};">Approximately 30 days from now</p>
        </div>

        <div style="text-align: center; margin-top: 32px;">
            <a href="${process.env.FRONTEND_URL || '#'}/settings" class="btn">Manage Subscription</a>
        </div>
    `;
    return wrapTemplate(content, title);
}

/**
 * Security Alert Email (New Login)
 */
export function securityAlertEmail() {
    const title = 'New Sign-In';
    const content = `
        <h1 class="h1" style="text-align: center;">New sign-in to your account</h1>
        <p class="p" style="text-align: center;">
            There was a new sign-in to your Nest account. If this was you, no action is needed.
        </p>

        <div style="background-color: #FEF2F2; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0; border: 1px solid #FEE2E2;">
            <p style="margin: 0; font-size: 14px; color: ${THEME.colors.textMain};">
                If you didn't sign in, please change your password immediately.
            </p>
        </div>

        <div style="text-align: center; margin-top: 32px;">
            <a href="${process.env.FRONTEND_URL || '#'}/settings" class="btn">Change Password</a>
        </div>
    `;
    return wrapTemplate(content, title);
}

/**
 * Share Link Weekly Digest
 */
export function shareLinkDigestEmail(totalDownloads: number, maxFileDownloads: number) {
    const title = 'Your Files are Popular';
    const content = `
        <h1 class="h1" style="text-align: center;">Weekly Share Summary</h1>
        <p class="p" style="text-align: center;">
            Your shared files were downloaded <strong>${totalDownloads}</strong> times this week.
        </p>

        <div style="background-color: #FAFAFA; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
            <p style="margin: 0; font-weight: 600; font-size: 14px; color: ${THEME.colors.textMain};">Most Popular File</p>
            <p style="margin: 4px 0 0 0; color: ${THEME.colors.textMuted};">${maxFileDownloads} downloads</p>
        </div>

        <div style="text-align: center; margin-top: 32px;">
            <a href="${process.env.FRONTEND_URL || '#'}/shared" class="btn">Manage Links</a>
        </div>
    `;
    return wrapTemplate(content, title);
}

/**
 * Account Inactive Nudge
 */
export function accountInactiveEmail() {
    const title = 'We Miss You';
    const content = `
        <h1 class="h1" style="text-align: center;">It's been a while</h1>
        <p class="p" style="text-align: center;">
            We haven't seen you in your Nest lately. Just a reminder that your encrypted files are safe and waiting for you.
        </p>

        <div style="text-align: center; margin-top: 32px;">
            <a href="${process.env.FRONTEND_URL || '#'}/login" class="btn">Sign In</a>
        </div>
    `;
    return wrapTemplate(content, title);
}
