import { EmailClient } from "@azure/communication-email";
import { createTransport } from "nodemailer";
import { EMAIL_SENDER_ENV, emailSender, type EmailSender } from "./config";

/** One rendered email, the same whichever service carries it. */
export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

async function viaAzure(sender: Extract<EmailSender, { kind: "azure" }>, mail: EmailMessage) {
  const client = new EmailClient(sender.connectionString);
  /**
   * beginSend rejects a bad sender or recipient at once. Delivery itself is
   * asynchronous and can take half a minute, so the job does not wait on it,
   * the same way an SMTP server accepts a message before it has been delivered.
   */
  await client.beginSend({
    senderAddress: sender.from,
    recipients: { to: [{ address: mail.to }] },
    content: { subject: mail.subject, html: mail.html, plainText: mail.text },
  });
}

async function viaSmtp(sender: Extract<EmailSender, { kind: "smtp" }>, mail: EmailMessage) {
  const transport = createTransport(sender.url);
  await transport.sendMail({
    from: sender.from,
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });
}

/** Sends one email down whichever service is configured. Throws with the reason. */
export async function sendEmail(mail: EmailMessage): Promise<void> {
  const sender = emailSender();
  if (!sender) {
    throw new Error(`Email alerts need ALERTS_FROM_EMAIL and one of ${EMAIL_SENDER_ENV}`);
  }
  if (sender.kind === "azure") {
    await viaAzure(sender, mail);
  } else {
    await viaSmtp(sender, mail);
  }
}
