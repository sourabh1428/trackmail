"use strict";

const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const nodemailer = require("nodemailer");
const { Resend } = require("resend");

const RESEND_FROM = "Sourabh Pathak <sourabh@referral.sourabhpathak.online>";
const VALID_CONNECTORS = ["ses", "gmail", "gmail2", "gmail3", "gmail4", "resend"];

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
    to, subject, html, text, replyTo,
  });
  return { messageId: result.messageId };
}

async function sendViaGmail2({ to, subject, html, text, replyTo }) {
  if (!process.env.EMAIL_USER3) throw new Error("[gmail2] EMAIL_USER3 env var is not set");
  if (!process.env.EMAIL_PASS3) throw new Error("[gmail2] EMAIL_PASS3 env var is not set");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: process.env.EMAIL_USER3, pass: process.env.EMAIL_PASS3 },
  });
  const result = await transporter.sendMail({
    from: `"Sourabh Pathak" <${process.env.EMAIL_USER3}>`,
    to, subject, html, text, replyTo,
  });
  return { messageId: result.messageId };
}

async function sendViaGmail3({ to, subject, html, text, replyTo }) {
  if (!process.env.EMAIL_USER4) throw new Error("[gmail3] EMAIL_USER4 env var is not set");
  if (!process.env.EMAIL_PASS4) throw new Error("[gmail3] EMAIL_PASS4 env var is not set");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: process.env.EMAIL_USER4, pass: process.env.EMAIL_PASS4 },
  });
  const result = await transporter.sendMail({
    from: `"Sourabh Pathak" <${process.env.EMAIL_USER4}>`,
    to, subject, html, text, replyTo,
  });
  return { messageId: result.messageId };
}

async function sendViaGmail4({ to, subject, html, text, replyTo }) {
  if (!process.env.EMAIL_USER5) throw new Error("[gmail4] EMAIL_USER5 env var is not set");
  if (!process.env.EMAIL_PASS5) throw new Error("[gmail4] EMAIL_PASS5 env var is not set");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: process.env.EMAIL_USER5, pass: process.env.EMAIL_PASS5 },
  });
  const result = await transporter.sendMail({
    from: `"Sourabh Pathak" <${process.env.EMAIL_USER5}>`,
    to, subject, html, text, replyTo,
  });
  return { messageId: result.messageId };
}

async function sendViaResend({ to, subject, html, text, replyTo }) {
  if (!process.env.resend_api_key) throw new Error("[resend] resend_api_key env var is not set");
  const resend = new Resend(process.env.resend_api_key);
  const result = await resend.emails.send({
    from: RESEND_FROM,
    to, subject, html, text,
    reply_to: replyTo,
  });
  if (result.error) throw new Error(result.error.message);
  return { messageId: result.data?.id };
}

const SENDERS = { ses: sendViaSES, gmail: sendViaGmail, gmail2: sendViaGmail2, gmail3: sendViaGmail3, gmail4: sendViaGmail4, resend: sendViaResend };

const DEFAULT_CONNECTOR_ORDER = ["ses", "gmail", "gmail2", "gmail3", "gmail4", "resend"];
const DEFAULT_DAILY_LIMIT = 20;

async function ensureConnectorDefaults(db) {
  const ops = DEFAULT_CONNECTOR_ORDER.map((name, i) => ({
    updateOne: {
      filter: { name },
      update: {
        $setOnInsert: { name, enabled: true, order: i + 1 },
        $min: { dailyLimit: DEFAULT_DAILY_LIMIT },
      },
      upsert: true,
    },
  }));
  await db.collection("ConnectorConfigs").bulkWrite(ops);
}

async function sendViaConnectors({ to, subject, html, text, replyTo }, db) {
  const istDate = getISTDate();

  const [configs, usageDocs] = await Promise.all([
    db.collection("ConnectorConfigs").find({}).sort({ order: 1 }).toArray(),
    db.collection("ConnectorUsage").find({ istDate }).toArray(),
  ]);

  const usageMap = {};
  for (const doc of usageDocs) usageMap[doc.name] = doc.sent;

  const available = configs
    .filter(c => c.enabled && SENDERS[c.name] && (usageMap[c.name] || 0) < c.dailyLimit)
    .sort((a, b) => (usageMap[a.name] || 0) - (usageMap[b.name] || 0));

  if (!available.length) {
    throw new Error("All connectors exhausted for today");
  }

  let lastError;
  for (const config of available) {
    let result;
    try {
      result = await SENDERS[config.name]({ to, subject, html, text, replyTo });
    } catch (e) {
      console.error(`[connectors] ${config.name} failed: ${e.message}`);
      lastError = e;
      continue;
    }

    try {
      await db.collection("ConnectorUsage").updateOne(
        { name: config.name, istDate },
        { $inc: { sent: 1 } },
        { upsert: true }
      );
    } catch (e) {
      console.warn(`[connectors] usage tracking failed for ${config.name}: ${e.message}`);
    }
    return { connector: config.name, messageId: result.messageId };
  }

  throw lastError || new Error("All connectors exhausted for today");
}

module.exports = { sendViaConnectors, ensureConnectorDefaults, getISTDate, VALID_CONNECTORS };