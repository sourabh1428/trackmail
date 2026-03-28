"use strict";

require("dotenv").config();

if (!process.env.MONGODB_URI) {
  throw new Error("[server] MONGODB_URI is not set");
}

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const { connectDB, closeDB, getDB } = require("./db");
const { sendEmail } = require("./mailer");
const { verifyJWT } = require("./middleware/auth");

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(cors({
  origin: [process.env.DASHBOARD_ORIGIN, "http://localhost:5173"].filter(Boolean),
}));
app.use(morgan("combined"));

const { PORT = 3000 } = process.env;

// ── Public routes ─────────────────────────────────────────────────────────────
app.use("/auth", require("./routes/auth"));    // POST /auth/login
app.use("/", require("./routes/tracking"));    // POST /track-event (x-track-secret)

app.get("/health", async (req, res) => {
  try {
    await getDB().command({ ping: 1 });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── JWT-protected routes ──────────────────────────────────────────────────────
// routes/stats.js and routes/templates.js each apply verifyJWT internally
app.use("/", require("./routes/stats"));           // GET /api/bunches, /api/stats, /api/events
app.use("/api", require("./routes/templates"));    // CRUD /api/templates

async function retryOnce(fn, { retries = 3, baseDelayMs = 500 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt > retries) throw err;
      await new Promise(res => setTimeout(res, baseDelayMs * Math.pow(2, attempt - 1)));
    }
  }
}

// POST /send-email — JWT-protected
app.post("/send-email", verifyJWT, async (req, res) => {
  const { to, subject, html, text, trackId } = req.body || {};
  if (!to || !subject || (!html && !text)) {
    return res.status(400).json({ error: "Missing required fields: to, subject, html|text" });
  }
  try {
    const result = await retryOnce(() => sendEmail({ to, subject, html, text }));
    if (trackId) {
      await getDB().collection("AlreadySent").updateOne(
        { trackId },
        { $set: { trackId, to, subject, sentAt: new Date(), messageId: result.messageId } },
        { upsert: true }
      );
    }
    console.log(`[send-email] SUCCESS to=${to}`);
    return res.json({ ok: true, result });
  } catch (e) {
    console.error(`[send-email] FAIL to=${to} error=${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /send-bulk-emails — JWT-protected
app.post("/send-bulk-emails", verifyJWT, async (req, res) => {
  const { bunchID, subject, htmlTemplate, textTemplate } = req.body || {};
  if (!bunchID || !subject || (!htmlTemplate && !textTemplate)) {
    return res.status(400).json({ error: "Missing required fields: bunchID, subject, htmlTemplate|textTemplate" });
  }
  try {
    const db = getDB();
    const recipients = await db.collection("Emails").find({ bunch_id: bunchID }).toArray();
    if (!recipients.length) {
      return res.json({ ok: true, message: "No recipients found for bunchID", sent: 0 });
    }

    const alreadySentDocs = await db.collection("AlreadySent").find({ bunch_id: bunchID }).toArray();
    const alreadySentSet = new Set(alreadySentDocs.map(d => d.email));

    let successCount = 0, failCount = 0;
    const results = [];

    for (const recipient of recipients) {
      const email = recipient.email || recipient.to;
      if (!email) {
        failCount++;
        results.push({ email: null, status: "fail", reason: "Missing email field" });
        continue;
      }
      if (alreadySentSet.has(email)) {
        results.push({ email, status: "skipped", reason: "Already sent" });
        continue;
      }
      try {
        const info = await retryOnce(() => sendEmail({ to: email, subject, html: htmlTemplate, text: textTemplate }));
        await db.collection("AlreadySent").updateOne(
          { bunch_id: bunchID, email },
          { $set: { bunch_id: bunchID, email, subject, sentAt: new Date(), messageId: info.messageId } },
          { upsert: true }
        );
        successCount++;
        results.push({ email, status: "success" });
        console.log(`[bulk] SUCCESS to=${email}`);
      } catch (err) {
        failCount++;
        results.push({ email, status: "fail", error: err.message });
        console.error(`[bulk] FAIL to=${email} error=${err.message}`);
      }
    }

    return res.json({ ok: true, bunchID, sent: successCount, failed: failCount, total: recipients.length, results });
  } catch (e) {
    console.error(`[send-bulk-emails] error=${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error("[unhandled]", err);
  return res.status(500).json({ ok: false, error: "Internal server error" });
});

// Graceful shutdown
async function shutdown() {
  console.log("[server] shutting down...");
  await closeDB();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Start: verify SMTP, connect DB, then listen
async function start() {
  await require("./mailer").transporter.verify();
  console.log("[mailer] SMTP verified");
  await connectDB();
  app.listen(PORT, () => console.log(`[server] listening on port ${PORT}`));
}

start().catch(err => { console.error("[server] startup failed:", err.message); process.exit(1); });
