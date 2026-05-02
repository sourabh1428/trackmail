"use strict";

const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");
require("dotenv").config();
const { sendViaConnectors } = require("./connectors");

const {
  MONGODB_URI, EMAIL_USER, BUNCH_ID, DRY_RUN,
  CHUNK_SIZE:        _CHUNK_SIZE,
  CHUNK_INDEX:       _CHUNK_INDEX,
  SEND_DELAY_MIN_MS: _DELAY_MIN,
  SEND_DELAY_MAX_MS: _DELAY_MAX,
  MAX_DAILY_SENDS:   _MAX_DAILY,
} = process.env;

const CHUNK_SIZE      = Math.min(parseInt(_CHUNK_SIZE  ?? "12",  10), 50);
const CHUNK_INDEX     = Math.max(parseInt(_CHUNK_INDEX ?? "0",   10), 0);
const DELAY_MIN_MS    = parseInt(_DELAY_MIN ?? "45000", 10);
const DELAY_MAX_MS    = parseInt(_DELAY_MAX ?? "90000", 10);
const MAX_DAILY_SENDS = Math.min(parseInt(_MAX_DAILY ?? "35",    10), 50);

if ([CHUNK_SIZE, CHUNK_INDEX, MAX_DAILY_SENDS, DELAY_MIN_MS, DELAY_MAX_MS].some(isNaN)) {
  throw new Error("Invalid env: CHUNK_SIZE, CHUNK_INDEX, MAX_DAILY_SENDS, SEND_DELAY_MIN/MAX_MS must be integers");
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
  console.log(`   chunk     : ${CHUNK_INDEX} (size=${CHUNK_SIZE})`);
  console.log(`   daily cap : ${MAX_DAILY_SENDS}`);
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

    // Self-email is only injected into chunk 0 to avoid triple-send across 3 daily runs
    const allEligibleDocs = validDocs.filter(u => !sentSet.has(u.email) && !unsubSet.has(u.email));
    if (EMAIL_USER && CHUNK_INDEX === 0 && !sentSet.has(EMAIL_USER) && !allEligibleDocs.find(u => u.email === EMAIL_USER)) {
      // Inject self-email as a synthetic doc (no evaluation doc needed)
      allEligibleDocs.unshift({ email: EMAIL_USER, evaluation: { personalization_hook: "" } });
    }

    // Enforce daily cap: count sends recorded today (UTC day) across all bunches
    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
    const todaySentCount = await alreadySentCol.countDocuments({ sentAt: { $gte: todayStart } });
    const remainingCap = Math.max(0, MAX_DAILY_SENDS - todaySentCount);
    if (remainingCap === 0) {
      console.log(`🚫 Daily cap reached (${todaySentCount}/${MAX_DAILY_SENDS}). Exiting.`);
      return;
    }

    // Slice this chunk, then clamp to remaining daily cap
    const chunkStart = CHUNK_INDEX * CHUNK_SIZE;
    const chunkRaw   = allEligibleDocs.slice(chunkStart, chunkStart + CHUNK_SIZE);
    const toSend     = chunkRaw.slice(0, remainingCap);

    const chunkEnd = chunkRaw.length ? chunkStart + chunkRaw.length - 1 : chunkStart;
    console.log(`📦 Chunk ${CHUNK_INDEX}: contacts[${chunkStart}..${chunkEnd}] = ${chunkRaw.length} eligible`);
    console.log(`✉️  To send: ${toSend.length}  (${sentSet.size} already sent, ${unsubSet.size} unsubscribed, ${allEligibleDocs.length - chunkRaw.length} outside chunk, ${chunkRaw.length - toSend.length} over daily cap)\n`);

    if (!toSend.length) {
      console.log("✅ Nothing left to send for this chunk.");
      return;
    }

    const template = await loadActiveTemplate(db);
    const plainText = loadTextTemplate();
    const SUBJECT = "Application for software engineering role";

    let success = 0, failed = 0;
    const startTime = Date.now();

    for (let i = 0; i < toSend.length; i++) {
      const doc = toSend[i];
      const email = doc.email;

      // Substitute {{PersonalizationHook}} with the LLM-generated opener.
      // When a hook is present, wrap it in a paragraph so it renders correctly in HTML.
      // When absent the placeholder collapses to nothing (empty string).
      const hookRaw = doc.evaluation?.personalization_hook || "";
      const hookHtml = hookRaw
        ? `<p style="margin:0 0 22px 0;">${hookRaw}</p>`
        : "";
      const personalizedTemplate = template.replace(/\{\{PersonalizationHook\}\}/g, hookHtml);
      const html = addTracking(personalizedTemplate, email, bunchID);

      if (isDry) {
        console.log(`  [DRY] would send → ${email} (score=${(doc.evaluation?.score ?? "n/a")}, hook="${hookRaw.slice(0, 60)}")`);
        success++;
        continue; // no delay in dry-run — preview is instant
      }

      try {
        const response = await retry(() => sendViaConnectors(
          { to: email, subject: SUBJECT, html, text: plainText, replyTo: EMAIL_REPLY_TO },
          db
        ));

        if (email !== EMAIL_USER) {
          await alreadySentCol.insertOne({ email, sentAt: new Date(), createdAt: new Date(), bunch_id: bunchID, subject: SUBJECT })
            .catch(e => { if (e.code !== 11000) throw e; });
          // Update status to "sent" in Emails collection
          if (doc._id) {
            await emailsColl.updateOne({ _id: doc._id }, { $set: { status: "sent" } }).catch(() => {});
          }
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
    console.log(`\n📊 Chunk ${CHUNK_INDEX} done — sent: ${success}, failed: ${failed}, elapsed: ${elapsed}s`);
    if (failed > 0) process.exit(1);
  } finally {
    await mongo.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
