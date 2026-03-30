"use strict";

const nodemailer = require("nodemailer");
const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");
const https = require("https");
require("dotenv").config();

const { MONGODB_URI, EMAIL_USER, EMAIL_PASS, BUNCH_ID, DRY_RUN } = process.env;

function todayBunchID() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
}

const { addTracking } = require("./tracking");

const TEMPLATE_PATH = path.join(__dirname, "test.html");

function loadFallbackTemplate() {
  return fs.readFileSync(TEMPLATE_PATH, "utf8").replace(/\r?\n|\r/g, "");
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
const RESUME_DRIVE_ID = "11kCloVzqQJvnMaFRKnC137dG7YsMgWml";

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const follow = (u) => https.get(u, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return follow(res.headers.location);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} fetching resume`));
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
    follow(url);
  });
}
const BLOCKED_DOMAINS = ["gmail.com", "moengage.com"];

async function main() {
  const bunchID = BUNCH_ID || todayBunchID();
  const isDry = DRY_RUN === "true";

  console.log(`\n📬 send-daily-emails`);
  console.log(`   bunchID : ${bunchID}`);
  console.log(`   dry-run : ${isDry}`);
  console.log(`   from    : ${EMAIL_USER}\n`);

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

    const users = await emailsColl.find({ bunch_id: bunchID }).toArray();
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

    const sent = await alreadySentCol
      .find({ email: { $in: validEmails } })
      .project({ email: 1 })
      .toArray();
    const sentSet = new Set(sent.map(d => d.email));

    const toSend = validEmails.filter(e => e === EMAIL_USER || !sentSet.has(e));
    console.log(`✉️  To send: ${toSend.length}  (${sentSet.size} already sent, skipped)\n`);

    if (!toSend.length) {
      console.log("✅ All emails already sent for today.");
      return;
    }

    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      pool: true,
      maxConnections: 1,
      rateLimit: 20,
      rateDelta: 60000,
      auth: { user: EMAIL_USER, pass: EMAIL_PASS },
      // Note: no tls.rejectUnauthorized override — Nodemailer defaults are correct for smtp.gmail.com:465
    });

    const template = await loadActiveTemplate(db);
    const SUBJECT = "Application for software engineering role";

    console.log("📎 Downloading resume...");
    const resumeBuffer = await downloadBuffer(
      `https://drive.google.com/uc?export=download&id=${RESUME_DRIVE_ID}`
    );
    console.log(`   resume size: ${(resumeBuffer.length / 1024).toFixed(1)} KB\n`);

    let success = 0, failed = 0;

    for (const email of toSend) {
      const html = addTracking(template, email, bunchID);

      if (isDry) {
        console.log(`  [DRY] would send → ${email}`);
        success++;
        continue;
      }

      try {
        const mailOptions = {
          from: EMAIL_USER, to: email, subject: SUBJECT, html,
          attachments: [{ filename: "Sourabh_Pathak_Resume.pdf", content: resumeBuffer, contentType: "application/pdf" }],
        };
        await retry(() => transporter.sendMail(mailOptions));

        if (email !== EMAIL_USER) {
          await alreadySentCol.insertOne({ email, sentAt: new Date(), bunch_id: bunchID, subject: SUBJECT })
            .catch(e => { if (e.code !== 11000) throw e; });
        }

        success++;
        console.log(`  ✅ ${email}`);
      } catch (e) {
        failed++;
        console.error(`  ❌ ${email} — ${e.message}`);
      }

      await new Promise(r => setTimeout(r, 1200));
    }

    console.log(`\n📊 Done — success: ${success}, failed: ${failed}`);
    if (failed > 0) process.exit(1);
  } finally {
    if (transporter) transporter.close();
    await mongo.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
