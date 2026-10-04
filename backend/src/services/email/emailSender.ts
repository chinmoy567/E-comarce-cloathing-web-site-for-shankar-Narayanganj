/** One outbound email. The provider behind it (SMTP today) is an implementation detail. */
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
