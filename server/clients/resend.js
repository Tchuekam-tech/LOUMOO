/**
 * LOUMOO Universal Transactional Email Client
 * Primary: High-reliability Google SMTP
 * Fallback: Resend API
 */

const nodemailer = require('nodemailer');
const config = require('../config');

const appPass = ((config.google && config.google.appPassword) || process.env.GOOGLE_APP_PASSWORD || '').replace(/\s+/g, '');
// The authenticating mailbox comes from configuration — never hardcoded. Both
// the password and the user must be present or the Gmail transport stays off.
const smtpUser = ((config.google && config.google.smtpUser) || process.env.GOOGLE_SMTP_USER || '').trim();
// The sender identity for every transactional message, so order/OTP/welcome mail
// all present the same From instead of each client inventing its own.
const defaultFrom = (config.email && config.email.from) || 'LOUMOO <noreply@loumoo.cm>';

let smtpTransporter = null;

try {
  if (!appPass || !smtpUser) {
    throw new Error('GOOGLE_APP_PASSWORD / GOOGLE_SMTP_USER not configured — Gmail SMTP transport is DISABLED.');
  }
  smtpTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: smtpUser,
      pass: appPass
    },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000
  });
  console.log('[EmailService] Gmail SMTP transport initialized successfully.');
} catch (e) {
  console.warn('[EmailService] SMTP init warning:', e.message);
}

/**
 * Sends transactional email with guaranteed delivery.
 */
async function sendEmail({ to, subject, html, from }) {
  const fromAddress = from || defaultFrom;

  // 1. Try primary Gmail SMTP
  if (smtpTransporter) {
    try {
      const info = await smtpTransporter.sendMail({
        from: fromAddress,
        to: to,
        subject: subject,
        html: html
      });
      console.log(`[EmailService] Delivered email to ${to} (Message ID: ${info.messageId})`);
      return { id: info.messageId, sent: true };
    } catch (smtpErr) {
      console.warn(`[EmailService] SMTP send error: ${smtpErr.message}, falling back to Resend...`);
    }
  }

  // 2. Fallback: Resend API
  if (config.resend && config.resend.apiKey) {
    try {
      // Bound the outbound call the same way the SMTP transport is bounded
      // (10s socket). Without a signal, undici's ~300s header/body timeout is
      // the only limit, so a slow Resend would hang the awaited OTP/auth
      // request for minutes instead of failing over to "not sent".
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.resend.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromAddress,
          to: Array.isArray(to) ? to : [to],
          subject: subject,
          html: html
        }),
        signal: AbortSignal.timeout(8000)
      });
      const data = await res.json();
      return { id: data.id, sent: res.ok };
    } catch (resendErr) {
      console.warn(`[EmailService] Resend fallback error: ${resendErr.message}`);
    }
  }

  return { id: null, sent: false, reason: 'No active email transport available' };
}

module.exports = {
  resendClient: null,
  sendEmail
};
