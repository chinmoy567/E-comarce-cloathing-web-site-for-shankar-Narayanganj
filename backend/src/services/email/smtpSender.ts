import nodemailer from 'nodemailer';
import { EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME } from '../../config/constants.js';
import type { EmailMessage, EmailSender } from './emailSender.js';

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  from?: string;
};

/** Port 465 is implicit TLS; 587 upgrades with STARTTLS (required, never silently downgraded). */
export function createSmtpSender(config: SmtpConfig): EmailSender {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: config.port !== 465,
    auth: { user: config.user, pass: config.password },
  });
  const from = `"${EMAIL_FROM_NAME}" <${config.from ?? EMAIL_FROM_ADDRESS}>`;

  return {
    async send(message) {
      await transport.sendMail({ from, ...message });
    },
  };
}
