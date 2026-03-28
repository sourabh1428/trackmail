"use strict";

const nodemailer = require("nodemailer");

const { EMAIL_USER, EMAIL_PASS } = process.env;

if (!EMAIL_USER || !EMAIL_PASS) {
  console.warn("[mailer] EMAIL_USER/EMAIL_PASS not set. Emails will fail until provided.");
}

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
});

// Verify SMTP credentials at startup — fail fast rather than on first send
transporter.verify().then(() => {
  console.log("[mailer] SMTP connection verified");
}).catch(err => {
  console.error("[mailer] SMTP verification failed:", err.message);
  process.exit(1);
});

async function sendEmail({ to, subject, text, html, attachments }) {
  if (!to) throw new Error("'to' is required");
  if (!subject) throw new Error("'subject' is required");
  return transporter.sendMail({ from: EMAIL_USER, to, subject, text, html, attachments });
}

module.exports = { transporter, sendEmail };
