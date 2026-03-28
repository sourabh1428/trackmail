"use strict";

const nodemailer = require("nodemailer");
const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const {
  MONGODB_URI,
  EMAIL_USER,
  EMAIL_PASS,
  BUNCH_ID, // optional override; defaults to today's DDMMYY
  DRY_RUN,  // set to "true" to preview without sending
} = process.env;

// ── BunchID: DDMMYY (e.g. 280326 for 28 Mar 2026) ──────────────────────────
function todayBunchID() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
}

// ── Template helpers ─────────────────────────────────────────────────────────
const TEMPLATE_PATH = path.join(__dirname, "test.html");
const TRACKING_BASE = "https://test-open.sppathak1428.workers.dev";

function loadTemplate() {
  return fs.readFileSync(TEMPLATE_PATH, "utf8").replace(/\r?\n|\r/g, "");
}


function addTracking(html, email) {
  const enc = encodeURIComponent(email);
  const pixel = `<img src="${TRACKING_BASE}/track-open?email=${enc}" width="1" height="1" style="position:absolute;left:-9999px;" alt="" />`;

  let out = html.replace(/<a\s+(?:[^>]*?\s+)?href=(['"])(.*?)\1/gi, (match, q, url) => {
    if (url.includes("/track-link") || url.startsWith("#") || url.startsWith("mailto:")) return match;
    const tracked = `${TRACKING_BASE}/track-link?email=${enc}&url=${encodeURIComponent(url)}`;
    return `<a href=${q}${tracked}${q}`;
  });

  return out.includes("</body>")
    ? out.replace("</body>", `${pixel}</body>`)
    : out + pixel;
}

// ── Retry helper ──────────────────────────────────────────────────────────────
async function retry(fn, retries = 3, baseMs = 5000) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e) {
      if (i === retries - 1) throw e;
      const wait = baseMs * Math.pow(2, i);
      console.log(`  ⏳ retry ${i + 1}/${retries} in ${wait}ms — ${e.message}`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const bunchID = BUNCH_ID || todayBunchID();
  const isDry   = DRY_RUN === "true";

  console.log(`\n📬 send-daily-emails`);
  console.log(`   bunchID : ${bunchID}`);
  console.log(`   dry-run : ${isDry}`);
  console.log(`   from    : ${EMAIL_USER}\n`);

  if (!MONGODB_URI) throw new Error("MONGODB_URI is not set");
  if (!EMAIL_USER || !EMAIL_PASS) throw new Error("EMAIL_USER / EMAIL_PASS not set");

  const mongo = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  await mongo.connect();
  const db             = mongo.db("Linkedin_scrape");
  const emailsColl     = db.collection("Emails");
  const alreadySentCol = db.collection("AlreadySent");

  // Ensure dedup index
  await alreadySentCol.createIndex({ email: 1 }, { unique: true }).catch(() => {});

  // 1. Fetch today's recipients
  const users = await emailsColl.find({ bunch_id: bunchID }).toArray();
  console.log(`📋 Found ${users.length} recipients for bunch "${bunchID}"`);

  if (!users.length) {
    console.log("ℹ️  Nothing to send. Exiting.");
    await mongo.close();
    return;
  }

  // 2. Filter valid & not-yet-sent (always include own address for verification)
  const validEmails = [...new Set(users.map(u => u.email).filter(e => e && e.includes("@")))];
  const sent = await alreadySentCol
    .find({ email: { $in: validEmails } })
    .project({ email: 1 })
    .toArray();
  const sentSet = new Set(sent.map(d => d.email));

  const toSend = validEmails.filter(e => e === EMAIL_USER || !sentSet.has(e));
  console.log(`✉️  To send: ${toSend.length}  (${sentSet.size} already sent, skipped)\n`);

  if (!toSend.length) {
    console.log("✅ All emails already sent for today.");
    await mongo.close();
    return;
  }

  // 3. Build transporter
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    pool: true,
    maxConnections: 1,
    rateLimit: 20,
    rateDelta: 60000,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    tls: { rejectUnauthorized: false },
  });

  const template = loadTemplate();
  const SUBJECT  = "Application for software engineering role";
  let success = 0, failed = 0;

  for (const email of toSend) {
    const html = addTracking(template, email);

    if (isDry) {
      console.log(`  [DRY] would send → ${email}`);
      success++;
      continue;
    }

    try {
      await retry(() => transporter.sendMail({ from: EMAIL_USER, to: email, subject: SUBJECT, html }));

      if (email !== EMAIL_USER) {
        await alreadySentCol.insertOne({ email, sentAt: new Date(), bunch_id: bunchID, subject: SUBJECT })
          .catch(e => { if (e.code !== 11000) throw e; }); // ignore dup key
      }

      success++;
      console.log(`  ✅ ${email}`);
    } catch (e) {
      failed++;
      console.error(`  ❌ ${email} — ${e.message}`);
    }

    // Small delay to stay under Gmail rate limits
    await new Promise(r => setTimeout(r, 1200));
  }

  transporter.close();
  await mongo.close();

  console.log(`\n📊 Done — success: ${success}, failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
