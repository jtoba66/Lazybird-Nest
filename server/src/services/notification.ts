import axios from 'axios';
import db from '../db';
import { sendEmail } from './email';

import { jobCompletedEmail, jobFailedEmail } from './email-templates';

// ... (existing imports)

/**
 * Notify user when job completes or fails
 * Sends email (if enabled) and webhook notifications
 */
export async function notifyUser(userId: number, job: any, status: 'COMPLETED' | 'FAILED') {
    try {
        const user = db.prepare('SELECT email, notification_email, webhook_url, email_notifications FROM users WHERE id = ?').get(userId) as any;
        if (!user) return;

        const targetEmail = user.notification_email || user.email;

        const subject = status === 'COMPLETED'
            ? `✅ Job Complete: ${job.original_filename}`
            : `❌ Job Failed: ${job.original_filename}`;

        // 1. Email Notification
        if (user.email_notifications && targetEmail) {
            try {
                const html = status === 'COMPLETED'
                    ? jobCompletedEmail(job)
                    : jobFailedEmail(job);

                const emailSent = await sendEmail({
                    to: targetEmail,
                    subject,
                    html
                });

                if (emailSent) {
                    console.log(`[Notification] ✅ Email sent to ${targetEmail} for Job ${job.id} (${status})`);
                } else {
                    console.log(`[Notification] ⚠️ Email skipped (SMTP not configured) for Job ${job.id}`);
                }
            } catch (mailErr) {
                console.error(`[Notification] ❌ Failed to send email for Job ${job.id}:`, mailErr);
            }
        }

        // 2. Webhook Notification
        if (user.webhook_url) {
            try {
                console.log(`[Notification] 📡 Triggering webhook: ${user.webhook_url}`);
                await axios.post(user.webhook_url, {
                    event: `job.${status.toLowerCase()}`,
                    timestamp: new Date().toISOString(),
                    job: {
                        id: job.id,
                        status: status,
                        original_filename: job.original_filename,
                        input_file: job.input_file,
                        result_metadata: job.result_metadata ? JSON.parse(job.result_metadata) : null,
                        error: status === 'FAILED' ? 'See job details for more information' : null
                    }
                }, {
                    timeout: 5000,
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'Portal-Media-Converter/1.0'
                    }
                });
                console.log(`[Notification] ✅ Webhook successful for Job ${job.id}`);
            } catch (webhookErr: any) {
                console.error(`[Notification] ❌ Webhook failed for Job ${job.id} (${user.webhook_url}):`, webhookErr.message);
            }
        }

    } catch (e) {
        console.error('[Notification] ❌ Error in notifyUser:', e);
    }
}
