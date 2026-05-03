"use strict";

const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

const { EMAIL_USER } = process.env;
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || EMAIL_USER;

if (!EMAIL_USER) {
  console.warn("[mailer] EMAIL_USER not set. Emails will fail until provided.");
}

const sesClient = new SESClient({ region: process.env.AWS_REGION || "ap-south-1" });

const FROM_ADDRESS = EMAIL_USER ? `"Sourabh Pathak" <${EMAIL_USER}>` : EMAIL_USER;

async function sendEmail({ to, subject, text, html, replyTo }) {
  if (!to) throw new Error("'to' is required");
  if (!subject) throw new Error("'subject' is required");
  const response = await sesClient.send(new SendEmailCommand({
    Source: FROM_ADDRESS,
    Destination: { ToAddresses: [to] },
    ReplyToAddresses: [replyTo || EMAIL_REPLY_TO],
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: {
        ...(html ? { Html: { Data: html, Charset: "UTF-8" } } : {}),
        ...(text ? { Text: { Data: text, Charset: "UTF-8" } } : {}),
      },
    },
  }));
  return { messageId: response.MessageId };
}

module.exports = { sendEmail };
