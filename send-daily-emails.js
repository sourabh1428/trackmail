"use strict";

const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");
require("dotenv").config();
const { sendViaConnectors, ensureConnectorDefaults } = require("./connectors");

const {
  MONGODB_URI, EMAIL_USER, BUNCH_ID, DRY_RUN,
  SEND_DELAY_MIN_MS: _DELAY_MIN,
  SEND_DELAY_MAX_MS: _DELAY_MAX,
} = process.env;

const DELAY_MIN_MS = parseInt(_DELAY_MIN ?? "45000", 10);
const DELAY_MAX_MS = parseInt(_DELAY_MAX ?? "90000", 10);

if ([DELAY_MIN_MS, DELAY_MAX_MS].some(isNaN)) {
  throw new Error("Invalid env: SEND_DELAY_MIN/MAX_MS must be integers");
}
if (DELAY_MIN_MS > DELAY_MAX_MS) {
  throw new Error(`SEND_DELAY_MIN_MS (${DELAY_MIN_MS}) must be <= SEND_DELAY_MAX_MS (${DELAY_MAX_MS})`);
}

function todayBunchID() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
}

const { addTracking } = require("./tracking");

const TEMPLATE_PATH = path.join(__dirname, "test.html");
const TEXT_TEMPLATE_PATH = path.join(__dirname, "test.txt");

function loadFallbackTemplate() {
  return fs.readFileSync(TEMPLATE_PATH, "utf8").replace(/\r?\n|\r/g, "");
}

function loadTextTemplate() {
  try {
    return fs.readFileSync(TEXT_TEMPLATE_PATH, "utf8");
  } catch (e) {
    console.warn("[template] test.txt missing — sending HTML-only:", e.message);
    return null;
  }
}

function buildUnsubscribeHeaders(email) {
  const mailto = `<mailto:${EMAIL_REPLY_TO}?subject=unsubscribe>`;
  if (API_BASE_URL) {
    const url = `${API_BASE_URL}/unsubscribe?email=${encodeURIComponent(email)}`;
    return {
      "List-Unsubscribe": `<${url}>, ${mailto}`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
  }
  return { "List-Unsubscribe": mailto };
}

async function loadActiveTemplate(db) {
  try {
    const tmpl = await db.collection("EmailTemplates").findOne({ isActive: true });
    if (tmpl?.html) return tmpl.html.replace(/\r?\n|\r/g, "");
  } catch (e) {
    console.warn("[template] MongoDB template load failed, falling back to test.html:", e.message);
  }
  return loadFallbackTemplate();
}

const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || EMAIL_USER;
const FROM_ADDRESS = EMAIL_USER ? `"Sourabh Pathak" <${EMAIL_USER}>` : undefined;
const API_BASE_URL = process.env.API_BASE_URL || "";

function randomDelay(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

// Only retry transient errors; skip permanent 4xx SES failures (except 429 rate-limit)
async function retry(fn, retries = 3, baseMs = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      const status = e.$metadata?.httpStatusCode;
      if (status && status >= 400 && status < 500 && status !== 429) throw e; // permanent failure — don't retry
      if (i === retries - 1) throw e;
      const wait = baseMs * Math.pow(2, i);
      console.log(`  ⏳ retry ${i + 1}/${retries} in ${wait}ms — ${e.message}`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BLOCKED_DOMAINS = ["gmail.com", "moengage.com"];

async function main() {
  const bunchID = BUNCH_ID || todayBunchID();
  const isDry = DRY_RUN === "true";

  console.log(`\n📬 send-daily-emails`);
  console.log(`   bunchID   : ${bunchID}`);
  console.log(`   delay     : ${DELAY_MIN_MS/1000}–${DELAY_MAX_MS/1000}s`);
  console.log(`   dry-run   : ${isDry}`);
  console.log(`   from      : ${EMAIL_USER}\n`);

  if (!MONGODB_URI) throw new Error("MONGODB_URI is not set");
  if (!EMAIL_USER) throw new Error("EMAIL_USER not set");

  const mongo = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  await mongo.connect();
  try {
    const db = mongo.db("Linkedin_scrape");
    const emailsColl = db.collection("Emails");
    const alreadySentCol = db.collection("AlreadySent");

    await alreadySentCol.createIndex({ email: 1 }, { unique: true }).catch(() => {});
    await ensureConnectorDefaults(db);

    // Only send to evaluated docs that scored >= 0.7; sort by score desc so best
    // matches go first. Docs without evaluation (e.g. legacy or pre-evaluator runs)
    // are excluded — run evaluate-eligibility.js first.
    const users = await emailsColl
      .find({ bunch_id: bunchID, status: "evaluated", "evaluation.score": { $gte: 0.7 } })
      .sort({ "evaluation.score": -1 })
      .toArray();
    console.log(`📋 Found ${users.length} recipients for bunch "${bunchID}"`);

    if (!users.length) {
      console.log("ℹ️  Nothing to send. Exiting.");
      return;
    }

    // Deduplicate by email address, preserving score-desc order; keep first occurrence.
    const seenEmails = new Set();
    const validDocs = users.filter(u => {
      const e = u.email;
      if (!e || !EMAIL_REGEX.test(e)) return false;
      const domain = e.split("@")[1].toLowerCase();
      if (BLOCKED_DOMAINS.includes(domain)) return false;
      if (seenEmails.has(e)) return false;
      seenEmails.add(e);
      return true;
    });
    const validEmails = validDocs.map(u => u.email);

    const [sentDocs, unsubDocs] = await Promise.all([
      alreadySentCol.find({ email: { $in: validEmails } }).project({ email: 1 }).toArray(),
      db.collection("Unsubscribed").find({ email: { $in: validEmails } }).project({ email: 1 }).toArray(),
    ]);
    const sentSet = new Set(sentDocs.map(d => d.email));
    const unsubSet = new Set(unsubDocs.map(d => d.email));

    // Mark skipped (already-sent or unsubscribed) docs in Emails collection
    const skippedEmails = validEmails.filter(e => sentSet.has(e) || unsubSet.has(e));
    if (skippedEmails.length && !isDry) {
      await emailsColl.updateMany(
        { bunch_id: bunchID, email: { $in: skippedEmails }, status: "evaluated" },
        { $set: { status: "skipped" } }
      ).catch(() => {});
    }

    const toSend = validDocs.filter(u => !sentSet.has(u.email) && !unsubSet.has(u.email));

    // Inject self-email at top if not already sent today
    if (EMAIL_USER && !toSend.find(u => u.email === EMAIL_USER)) {
      const selfTodayStart = new Date(); selfTodayStart.setUTCHours(0, 0, 0, 0);
      const selfAlreadySent = await alreadySentCol.findOne({ email: EMAIL_USER, sentAt: { $gte: selfTodayStart } });
      if (!selfAlreadySent) {
        toSend.unshift({ email: EMAIL_USER, evaluation: { score: 1, email_subject: "", email_preview_text: "", email_body: "" } });
      }
    }

    console.log(`✉️  To send: ${toSend.length}  (${sentSet.size} already sent, ${unsubSet.size} unsubscribed)\n`);

    if (!toSend.length) {
      console.log("✅ Nothing to send today.");
      return;
    }

    const template = await loadActiveTemplate(db);
    const plainText = loadTextTemplate();

    let success = 0, failed = 0;
    const startTime = Date.now();

    for (let i = 0; i < toSend.length; i++) {
      const doc = toSend[i];
      const email = doc.email;

      const previewText = doc.evaluation?.email_preview_text || "";
      const bodyRaw = doc.evaluation?.email_body || "";

      // Split LLM-generated plain-text body into paragraphs and wrap each in <p>
      const bodyHtml = bodyRaw.trim()
        ? bodyRaw
            .split(/\n\n+/)
            .map(p => `<p style="margin:0 0 18px 0;">${p.trim()}</p>`)
            .join("")
        : `<p style="margin:0 0 18px 0;">Hi, I found your email on LinkedIn and wanted to reach out about potential opportunities.</p>`;

      const personalizedTemplate = template
        .replace(/\{\{PreviewText\}\}/g, previewText)
        .replace(/\{\{EmailBody\}\}/g, bodyHtml);
      const html = addTracking(personalizedTemplate, email, bunchID);

      // Personalized subject from evaluator; fallback to generic if missing
      const FALLBACK_SUBJECT = "quick note — software engineering role";
      const SUBJECT = (doc.evaluation?.email_subject || "").trim() || FALLBACK_SUBJECT;

      // Personalize plain text version per-recipient
      const personalizedText = plainText
        ? plainText.replace(/\{\{EmailBody\}\}/g, bodyRaw.trim() || "Hi, I found your email on LinkedIn and wanted to reach out about potential opportunities.")
        : null;

      if (isDry) {
        console.log(`  [DRY] would send → ${email} (score=${(doc.evaluation?.score ?? "n/a")}, subject="${SUBJECT}")`);
        console.log(`         preview: "${previewText.slice(0, 80)}"`);
        console.log(`         body   : "${bodyRaw.slice(0, 80)}..."`);
        success++;
        continue; // no delay in dry-run — preview is instant
      }

      // Guard against concurrent runs: re-check AlreadySent immediately before sending.
      // The pre-flight check above is a snapshot; a parallel run may have sent this
      // email in the window since then. A findOne here is cheap and closes that gap.
      // Also guards the self-email — since it is tracked in AlreadySent now, this check
      // prevents it from being re-sent if the script is run again for the same bunch.
      const alreadyClaimedNow = await alreadySentCol.findOne({ email, bunch_id: bunchID });
      if (alreadyClaimedNow) {
        console.log(`  ⏭️  ${email} — already sent by concurrent run, skipping`);
        continue;
      }

      try {
        const response = await sendViaConnectors(
          { to: email, subject: SUBJECT, html, text: personalizedText, replyTo: EMAIL_REPLY_TO },
          db
        );

        if (email === EMAIL_USER) {
          // Self-email: update in place so sentAt stays current (unique index on email blocks
          // insertOne when any prior entry exists, making the date-based injection guard stale).
          await alreadySentCol.updateOne(
            { email },
            { $set: { sentAt: new Date(), bunch_id: bunchID, subject: SUBJECT },
              $setOnInsert: { email, createdAt: new Date() } },
            { upsert: true }
          ).catch(() => {});
        } else {
          await alreadySentCol.insertOne({ email, sentAt: new Date(), createdAt: new Date(), bunch_id: bunchID, subject: SUBJECT })
            .catch(e => { if (e.code !== 11000) throw e; });
        }
        // Update status to "sent" in Emails collection (synthetic self-email docs have no _id)
        if (doc._id) {
          await emailsColl.updateOne({ _id: doc._id }, { $set: { status: "sent" } }).catch(() => {});
        }

        success++;
        console.log(`  ✅ ${email} via ${response.connector} (MessageId=${response.messageId})`);
      } catch (e) {
        failed++;
        console.error(`  ❌ ${email} — ${e.message}`);
      }

      // Skip delay after the last email
      if (i < toSend.length - 1) {
        const delay = randomDelay(DELAY_MIN_MS, DELAY_MAX_MS);
        console.log(`  ⏳ waiting ${(delay / 1000).toFixed(1)}s before next send...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n📊 Done — sent: ${success}, failed: ${failed}, elapsed: ${elapsed}s`);
    if (failed > 0) process.exit(1);
  } finally {
    await mongo.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
