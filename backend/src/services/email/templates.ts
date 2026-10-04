import { SITE_NAME } from '../../config/constants.js';
import type { EmailMessage } from './emailSender.js';

/** Password-reset OTP message. The code is the only variable; it is digits, so no escaping is needed. */
export function passwordResetOtpEmail(to: string, code: string, ttlMinutes: number): EmailMessage {
  const subject = `Your ${SITE_NAME} password reset code`;
  const text =
    `Your ${SITE_NAME} password reset code is ${code}.\n\n` +
    `It expires in ${ttlMinutes} minutes and can be used once. ` +
    `If you did not request this, you can ignore this email.`;
  const html =
    `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#111">` +
    `<h2 style="margin:0 0 16px">${SITE_NAME}</h2>` +
    `<p>Use this code to reset your password:</p>` +
    `<p style="font-size:28px;font-weight:bold;letter-spacing:6px;margin:16px 0">${code}</p>` +
    `<p>It expires in ${ttlMinutes} minutes and can be used once.</p>` +
    `<p style="color:#666;font-size:13px">If you did not request this, you can ignore this email.</p>` +
    `</div>`;
  return { to, subject, text, html };
}

/** Phone-change OTP, sent to the customer's verified email. Only the last 3 digits of the new number are shown. */
export function phoneChangeOtpEmail(to: string, code: string, ttlMinutes: number, newPhone: string): EmailMessage {
  const subject = `Confirm your new ${SITE_NAME} phone number`;
  const hint = `01******${newPhone.slice(-3)}`;
  const text =
    `Your ${SITE_NAME} code to change your login phone number to ${hint} is ${code}.\n\n` +
    `It expires in ${ttlMinutes} minutes and can be used once. ` +
    `If you did not request this, change your password now.`;
  const html =
    `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#111">` +
    `<h2 style="margin:0 0 16px">${SITE_NAME}</h2>` +
    `<p>Use this code to change your login phone number to <strong>${hint}</strong>:</p>` +
    `<p style="font-size:28px;font-weight:bold;letter-spacing:6px;margin:16px 0">${code}</p>` +
    `<p>It expires in ${ttlMinutes} minutes and can be used once.</p>` +
    `<p style="color:#666;font-size:13px">If you did not request this, change your password now.</p>` +
    `</div>`;
  return { to, subject, text, html };
}

/** Email-change confirmation link. `link` is built by the caller from PUBLIC_SITE_URL plus a hex token. */
export function emailChangeEmail(to: string, link: string, ttlHours: number): EmailMessage {
  const subject = `Confirm your email address for ${SITE_NAME}`;
  const text =
    `Confirm this email address for your ${SITE_NAME} account by opening:\n${link}\n\n` +
    `The link expires in ${ttlHours} hours. If you did not request this, you can ignore this email.`;
  const html =
    `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#111">` +
    `<h2 style="margin:0 0 16px">${SITE_NAME}</h2>` +
    `<p>Confirm this email address for your account:</p>` +
    `<p><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Confirm email</a></p>` +
    `<p style="color:#666;font-size:13px">The link expires in ${ttlHours} hours. If you did not request this, you can ignore this email.</p>` +
    `</div>`;
  return { to, subject, text, html };
}
