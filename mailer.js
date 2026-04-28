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

// transporter.verify() is called by server.js start() to fail fast on bad credentials

const FROM_ADDRESS = EMAIL_USER ? `"Sourabh Pathak" <${EMAIL_USER}>` : EMAIL_USER;

const DEFAULT_HEADERS = {
  "List-Unsubscribe": `<mailto:${EMAIL_USER}?subject=unsubscribe>`,
};

async function sendEmail({ to, subject, text, html, attachments, headers, replyTo }) {
  if (!to) throw new Error("'to' is required");
  if (!subject) throw new Error("'subject' is required");
  return transporter.sendMail({
    from: FROM_ADDRESS,
    replyTo: replyTo || EMAIL_USER,
    to, subject, text, html, attachments,
    headers: { ...DEFAULT_HEADERS, ...headers },
  });
}

module.exports = { transporter, sendEmail };
