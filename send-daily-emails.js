"use strict";

const nodemailer = require("nodemailer");
const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const {
  MONGODB_URI, EMAIL_USER, EMAIL_PASS, BUNCH_ID, DRY_RUN,
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
  const mailto = `<mailto:${EMAIL_USER}?subject=unsubscribe>`;
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

const FROM_ADDRESS = EMAIL_USER ? `"Sourabh Pathak" <${EMAIL_USER}>` : undefined;
const API_BASE_URL = process.env.API_BASE_URL || "";

function randomDelay(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

// Only retry transient errors; skip permanent 5xx SMTP failures
async function retry(fn, retries = 3, baseMs = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (e.responseCode >= 500 && e.responseCode < 600) throw e; // permanent failure — don't retry
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
  if (!EMAIL_USER || !EMAIL_PASS) throw new Error("EMAIL_USER / EMAIL_PASS not set");

  const mongo = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  await mongo.connect();
  let transporter;
  try {
    const db = mongo.db("Linkedin_scrape");
    const emailsColl = db.collection("Emails");
    const alreadySentCol = db.collection("AlreadySent");

    await alreadySentCol.createIndex({ email: 1 }, { unique: true }).catch(() => {});

    // _id sort gives stable, insertion-order determinism — chunk slices never overlap
    const users = await emailsColl.find({ bunch_id: bunchID }).sort({ _id: 1 }).toArray();
    console.log(`📋 Found ${users.length} recipients for bunch "${bunchID}"`);

    if (!users.length) {
      console.log("ℹ️  Nothing to send. Exiting.");
      return;
    }

    const validEmails = [...new Set(
      users.map(u => u.email).filter(e => {
        if (!e || !EMAIL_REGEX.test(e)) return false;
        const domain = e.split("@")[1].toLowerCase();
        return !BLOCKED_DOMAINS.includes(domain);
      })
    )];

    const [sentDocs, unsubDocs] = await Promise.all([
      alreadySentCol.find({ email: { $in: validEmails } }).project({ email: 1 }).toArray(),
      db.collection("Unsubscribed").find({ email: { $in: validEmails } }).project({ email: 1 }).toArray(),
    ]);
    const sentSet = new Set(sentDocs.map(d => d.email));
    const unsubSet = new Set(unsubDocs.map(d => d.email));

    // Self-email is only injected into chunk 0 to avoid triple-send across 3 daily runs
    const allEligible = validEmails.filter(e => !sentSet.has(e) && !unsubSet.has(e));
    if (EMAIL_USER && CHUNK_INDEX === 0 && !sentSet.has(EMAIL_USER) && !allEligible.includes(EMAIL_USER)) {
      allEligible.unshift(EMAIL_USER);
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
    const chunkRaw   = allEligible.slice(chunkStart, chunkStart + CHUNK_SIZE);
    const toSend     = chunkRaw.slice(0, remainingCap);

    const chunkEnd = chunkRaw.length ? chunkStart + chunkRaw.length - 1 : chunkStart;
    console.log(`📦 Chunk ${CHUNK_INDEX}: contacts[${chunkStart}..${chunkEnd}] = ${chunkRaw.length} eligible`);
    console.log(`✉️  To send: ${toSend.length}  (${sentSet.size} already sent, ${unsubSet.size} unsubscribed, ${allEligible.length - chunkRaw.length} outside chunk, ${chunkRaw.length - toSend.length} over daily cap)\n`);

    if (!toSend.length) {
      console.log("✅ Nothing left to send for this chunk.");
      return;
    }

    // No pool — sendMail blocks until SMTP delivery so the jitter below
    // genuinely spaces transmissions rather than just queue-intake events.
    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    });

    const template = await loadActiveTemplate(db);
    const plainText = loadTextTemplate();
    const SUBJECT = "Application for software engineering role";

    let success = 0, failed = 0;
    const startTime = Date.now();

    for (let i = 0; i < toSend.length; i++) {
      const email = toSend[i];
      const html = addTracking(template, email, bunchID);

      if (isDry) {
        console.log(`  [DRY] would send → ${email}`);
        success++;
        continue; // no delay in dry-run — preview is instant
      }

      try {
        const mailOptions = {
          from: FROM_ADDRESS,
          replyTo: EMAIL_USER,
          to: email,
          subject: SUBJECT,
          html,
          text: plainText || undefined,
          headers: buildUnsubscribeHeaders(email),
        };
        await retry(() => transporter.sendMail(mailOptions));

        if (email !== EMAIL_USER) {
          await alreadySentCol.insertOne({ email, sentAt: new Date(), createdAt: new Date(), bunch_id: bunchID, subject: SUBJECT })
            .catch(e => { if (e.code !== 11000) throw e; });
        }

        success++;
        console.log(`  ✅ ${email}`);
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
    if (transporter) transporter.close();
    await mongo.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
