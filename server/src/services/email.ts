/**
 * Email Service
 * Handles sending emails for password resets and notifications
 * Updated with Portal light mode theme (cyan/blue color scheme)
 */

import nodemailer from 'nodemailer';
import { env } from '../config/env';

// Create transporter
const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST || 'smtp.gmail.com',
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465, // Fix: Use SSL for port 465
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS
  }
});

// Verify connection on startup (optional)
if (env.SMTP_USER && env.SMTP_PASS) {
  transporter.verify((error) => {
    if (error) {
      console.error('[Email] SMTP connection failed:', error.message);
    } else {
      console.log('[Email] SMTP server ready to send emails');
    }
  });
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

import {
  passwordResetEmail,
  passwordChangedEmail,
  welcomeEmail,
  storageQuotaWarningEmail,
  fileUploadedEmail,
  fileUploadFailedEmail,
  subscriptionStartedEmail,
  subscriptionCanceledEmail,
  paymentFailedEmail,
  paymentReceivedEmail,
  securityAlertEmail,
  cancellationFarewellEmail,
  shareLinkDigestEmail,
  accountInactiveEmail
} from './email-templates';

// ... (existing send functions) ...

/**
 * Send share link digest email
 */
export async function sendShareLinkDigestEmail(email: string, totalDownloads: number, maxFileDownloads: number): Promise<boolean> {
  const html = shareLinkDigestEmail(totalDownloads, maxFileDownloads);

  return sendEmail({
    to: email,
    subject: 'Your Weekly Share Summary - Nest',
    html
  });
}

/**
 * Send account inactive email
 */
export async function sendAccountInactiveEmail(email: string): Promise<boolean> {
  const html = accountInactiveEmail();

  return sendEmail({
    to: email,
    subject: 'We Miss You at Nest',
    html
  });
}

/**
 * Send email
 */
export async function sendEmail({ to, subject, html, text }: EmailOptions): Promise<boolean> {
  // Skip if SMTP not configured
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    console.warn('[Email] SMTP not configured - email not sent');
    console.log('[Email] Would have sent to:', to);
    console.log('[Email] Subject:', subject);
    console.log('[Email] Content:', text || html.substring(0, 100) + '...');
    return false;
  }

  try {
    await transporter.sendMail({
      from: env.EMAIL_FROM,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, '') // Strip HTML for text version
    });

    console.log('[Email] Sent successfully to:', to);
    return true;
  } catch (error: any) {
    console.error('[Email] Failed to send:', error.message);
    return false;
  }
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(email: string, resetToken: string): Promise<boolean> {
  // Use first URL if multiple are provided
  const frontendUrl = env.FRONTEND_URL.split(',')[0].trim();
  const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

  const html = passwordResetEmail(resetUrl);

  return sendEmail({
    to: email,
    subject: 'Reset Your Password - Nest',
    html
  });
}

/**
 * Send password reset confirmation email
 */
export async function sendPasswordResetConfirmation(email: string): Promise<boolean> {
  const html = passwordChangedEmail();

  return sendEmail({
    to: email,
    subject: 'Password Changed Successfully - Nest',
    html
  });
}

/**
 * Send welcome email (Signup)
 */
export async function sendWelcomeEmail(email: string): Promise<boolean> {
  const html = welcomeEmail(email);

  return sendEmail({
    to: email,
    subject: 'Welcome to Nest',
    html
  });
}

/**
 * Send storage quota warning email
 */
export async function sendStorageQuotaWarning(email: string): Promise<boolean> {
  const html = storageQuotaWarningEmail(email, 0, 0, 'unknown');

  return sendEmail({
    to: email,
    subject: 'Storage Quota Exceeded - Nest',
    html
  });
}

/**
 * Send file upload success email (zero-knowledge - no filename)
 */
export async function sendFileUploadedEmail(email: string): Promise<boolean> {
  const html = fileUploadedEmail();

  return sendEmail({
    to: email,
    subject: 'File Secured - Nest',
    html
  });
}

/**
 * Send file upload failed email
 */
export async function sendFileUploadFailedEmail(email: string, filename: string): Promise<boolean> {
  const html = fileUploadFailedEmail(filename);

  return sendEmail({
    to: email,
    subject: `Issue securing your file: ${filename} - Nest`,
    html
  });
}

/**
 * Send subscription started email
 */
export async function sendSubscriptionStartedEmail(email: string): Promise<boolean> {
  const html = subscriptionStartedEmail();

  return sendEmail({
    to: email,
    subject: 'Nest Pro Subscription Active',
    html
  });
}

/**
 * Send subscription canceled email
 */
export async function sendSubscriptionCanceledEmail(email: string): Promise<boolean> {
  const html = subscriptionCanceledEmail();

  return sendEmail({
    to: email,
    subject: 'Nest Pro Subscription Canceled',
    html
  });
}

/**
 * Send payment failed email
 */
export async function sendPaymentFailedEmail(email: string): Promise<boolean> {
  const html = paymentFailedEmail();

  return sendEmail({
    to: email,
    subject: 'Action Required: Payment Failed - Nest',
    html
  });
}

/**
 * Send payment received email (monthly renewal)
 */
export async function sendPaymentReceivedEmail(email: string, amount: string): Promise<boolean> {
  const html = paymentReceivedEmail(amount);

  return sendEmail({
    to: email,
    subject: 'Payment Received - Nest Pro',
    html
  });
}

/**
 * Send security alert email (new login)
 */
export async function sendSecurityAlertEmail(email: string): Promise<boolean> {
  const html = securityAlertEmail();

  return sendEmail({
    to: email,
    subject: 'New Sign-In to Your Account - Nest',
    html
  });
}

/**
 * Send cancellation farewell email (with consequences)
 */
export async function sendCancellationFarewellEmail(email: string): Promise<boolean> {
  const html = cancellationFarewellEmail();

  return sendEmail({
    to: email,
    subject: 'Your Subscription Has Been Canceled - Nest',
    html
  });
}
