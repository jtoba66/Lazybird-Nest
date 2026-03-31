import { sendEmail } from '../services/email';

/**
 * Proposed Minimalist Template Wrapper
 * - No background colors (white only)
 * - Fewer shadows/borders
 * - Traditional "letter" layout
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

async function main() {
    const email = 'upsellintegrated@gmail.com';
    const title = 'Your Nest account is ready';
    
    const content = `
        <h1 class="h1">Welcome aboard!</h1>
        <p class="p">
            I'm personally reaching out to let you know that your Nest account is now active and ready for use. 
            All your files will be protected with our end-to-end zero-knowledge encryption.
        </p>
        
        <p class="p">
            You can start securing your files immediately by logging in to your dashboard:
        </p>

        <a href="https://nest.lazybird.io" class="btn">Go to Dashboard</a>

        <p class="p" style="margin-top: 32px; font-size: 14px; font-style: italic;">
            Note: As a zero-knowledge service, we never store your master key. Please keep it safe!
        </p>
    `;

    const html = wrapProposedTemplate(content, title);

    console.log(`[Template-Test] Sending proposed "Inbox-Friendly" email to: ${email}`);
    
    try {
        const success = await sendEmail({ to: email, subject: title, html });
        if (success) {
            console.log('[Template-Test] ✅ Success! Check the inbox of upsellintegrated@gmail.com');
            process.exit(0);
        } else {
            console.error('[Template-Test] ❌ Failed to send.');
            process.exit(1);
        }
    } catch (error) {
        console.error('[Template-Test] ❌ Error:', error);
        process.exit(1);
    }
}

main();
