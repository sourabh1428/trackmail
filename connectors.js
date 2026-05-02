"use strict";

const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const nodemailer = require("nodemailer");
const { Resend } = require("resend");

const RESEND_FROM = "Sourabh Pathak <sourabh@referral.sourabhpathak.online>";
const VALID_CONNECTORS = ["ses", "gmail", "resend"];

function getISTDate() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

async function sendViaSES({ to, subject, html, text, replyTo }) {
  if (!process.env.EMAIL_USER) throw new Error("[ses] EMAIL_USER env var is not set");
  const client = new SESClient({ region: process.env.AWS_REGION || "ap-south-1" });
  const fromAddr = `"Sourabh Pathak" <${process.env.EMAIL_USER}>`;
  const replyToAddr = replyTo || process.env.EMAIL_REPLY_TO || process.env.EMAIL_USER;
  const response = await client.send(new SendEmailCommand({
    Source: fromAddr,
    Destination: { ToAddresses: [to] },
    ReplyToAddresses: [replyToAddr],
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

async function sendViaGmail({ to, subject, html, text, replyTo }) {
  if (!process.env.EMAIL_USER2) throw new Error("[gmail] EMAIL_USER2 env var is not set");
  if (!process.env.EMAIL_PASS2) throw new Error("[gmail] EMAIL_PASS2 env var is not set");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: process.env.EMAIL_USER2, pass: process.env.EMAIL_PASS2 },
  });
  const result = await transporter.sendMail({
    from: `"Sourabh Pathak" <${process.env.EMAIL_USER2}>`,
    to,
    subject,
    html,
    text,
    replyTo,
  });
  return { messageId: result.messageId };
}

async function sendViaResend({ to, subject, html, text, replyTo }) {
  if (!process.env.resend_api_key) throw new Error("[resend] resend_api_key env var is not set");
  const resend = new Resend(process.env.resend_api_key);
  const result = await resend.emails.send({
    from: RESEND_FROM,
    to,
    subject,
    html,
    text,
    reply_to: replyTo,
  });
  if (result.error) throw new Error(result.error.message);
  return { messageId: result.data?.id };
}

const SENDERS = { ses: sendViaSES, gmail: sendViaGmail, resend: sendViaResend };

async function sendViaConnectors({ to, subject, html, text, replyTo }, db) {
  const istDate = getISTDate();

  const [configs, usageDocs] = await Promise.all([
    db.collection("ConnectorConfigs").find({}).sort({ order: 1 }).toArray(),
    db.collection("ConnectorUsage").find({ istDate }).toArray(),
  ]);

  const usageMap = {};
  for (const doc of usageDocs) usageMap[doc.name] = doc.sent;

  let lastError;
  for (const config of configs) {
    if (!config.enabled) continue;
    const sent = usageMap[config.name] || 0;
    if (sent >= config.dailyLimit) continue;

    const sender = SENDERS[config.name];
    if (!sender) continue;

    try {
      const result = await sender({ to, subject, html, text, replyTo });
      await db.collection("ConnectorUsage").updateOne(
        { name: config.name, istDate },
        { $inc: { sent: 1 } },
        { upsert: true }
      );
      return { connector: config.name, messageId: result.messageId };
    } catch (e) {
      console.error(`[connectors] ${config.name} failed: ${e.message}`);
      lastError = e;
    }
  }

  throw lastError || new Error("All connectors exhausted for today");
}

module.exports = { sendViaConnectors, getISTDate, VALID_CONNECTORS };
