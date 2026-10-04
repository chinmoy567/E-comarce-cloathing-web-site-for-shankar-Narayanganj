import { getEnv } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import type { EmailMessage, EmailSender } from './emailSender.js';
import { createSmtpSender } from './smtpSender.js';

export type { EmailMessage, EmailSender } from './emailSender.js';

let override: EmailSender | null = null;
let cached: EmailSender | null = null;

/** Test hook: route every email to a capturing sender. Pass null to restore the real one. */
export function setEmailSenderForTests(sender: EmailSender | null): void {
  override = sender;
}

function build(): EmailSender {
  const env = getEnv();
  if (!env.SMTP_HOST || !env.SMTP_MAIL || !env.SMTP_PASSWORD) {
    // Unconfigured: drop the message. The message body (which holds the OTP) is never logged.
    return {
      async send() {
        logger.warn('Email not sent: SMTP is not configured.');
      },
    };
  }
  return createSmtpSender({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_MAIL,
    password: env.SMTP_PASSWORD,
    from: env.EMAIL_FROM,
  });
}

/**
 * Sends an email, never throwing: a delivery failure must not change an endpoint's response
 * (that would reveal whether an account exists). The failure is logged without the message body.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  try {
    const sender = override ?? (cached ??= build());
    await sender.send(message);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : 'unknown' }, 'Email delivery failed.');
  }
}
