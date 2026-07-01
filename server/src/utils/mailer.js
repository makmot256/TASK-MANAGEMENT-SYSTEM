import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter = null;
if (env.smtp.host && env.smtp.user) {
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: { user: env.smtp.user, pass: env.smtp.pass },
  });
}

// Sends an email when SMTP is configured; otherwise logs it (dev fallback).
export async function sendMail({ to, subject, text, html }) {
  if (!transporter) {
    console.log(`\n[email:dev] To: ${to}\n[email:dev] Subject: ${subject}\n[email:dev] ${text || ''}\n`);
    return { mocked: true };
  }
  return transporter.sendMail({ from: env.smtp.from, to, subject, text, html });
}
