"use strict";

/**
 * evaluate-eligibility.js
 *
 * Reads today's scraped Emails documents (status == "scraped"), calls Gemini
 * 2.5 Flash-Lite with a structured JSON response schema to score each one,
 * and writes the evaluation back to MongoDB (status → "evaluated").
 *
 * Env vars:
 *   MONGODB_URI        — required
 *   GEMINI_API_KEY     — required
 *   BUNCH_ID           — optional override (DDMMYY); defaults to today
 *   EVAL_DRY_RUN=true  — log verdicts without writing to MongoDB
 */

const { MongoClient } = require("mongodb");
const { GoogleGenAI } = require("@google/genai");
require("dotenv").config();

const { MONGODB_URI, GEMINI_API_KEY, BUNCH_ID, EVAL_DRY_RUN } = process.env;

const isDryRun = EVAL_DRY_RUN === "true";

// ─── Gemini configuration ────────────────────────────────────────────────────

const MODEL = "gemini-2.5-flash-lite-preview-06-17";

// Rate limit: 15 RPM → one call every 4 seconds minimum.
const RPM_LIMIT = 15;
const MIN_CALL_INTERVAL_MS = Math.ceil((60 / RPM_LIMIT) * 1000); // 4000 ms

// Structured output schema for Gemini
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    score: {
      type: "number",
      description: "Reply probability between 0.0 and 1.0",
    },
    verdict: {
      type: "string",
      enum: ["send", "skip"],
    },
    reasoning: {
      type: "string",
      description: "One-sentence explanation of the verdict",
    },
    matched_keywords: {
      type: "array",
      items: { type: "string" },
      description: "Keywords from the post that match the candidate profile",
    },
    personalization_hook: {
      type: "string",
      description:
        "A short (1–2 sentence) personalised opener for the cold email referencing something specific from the post. Empty string if verdict is skip.",
    },
  },
  required: ["score", "verdict", "reasoning", "matched_keywords", "personalization_hook"],
};

// ─── Candidate profile (hardcoded) ───────────────────────────────────────────

const MY_PROFILE = `
Name: Sourabh Pathak
Experience: ~2 years (frontend/full-stack)
Current role: Solutions Engineer at MoEngage — building integrations and tooling for enterprise clients (Swiggy, JPMC).
Previous: Built Easibill end-to-end — invoicing SaaS with backend, billing logic, WhatsApp notifications.
Core stack: React, TypeScript, Node.js, PostgreSQL, MongoDB, REST APIs.
Location: Bengaluru, India. Open to remote or hybrid roles based in India.
Target roles: SDE-1, Frontend Engineer, Full-Stack Engineer.
`.trim();

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(doc) {
  const postContext = [
    doc.post_text || "(no post text available)",
    doc.role ? `Role mentioned: ${doc.role}` : "",
    doc.company ? `Company: ${doc.company}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `You are a job-search assistant. Given a recruiter's LinkedIn post and a candidate's profile, evaluate whether the candidate should send a cold email application.

## Candidate profile
${MY_PROFILE}

## Recruiter post
${postContext}

## Skip rules (set verdict="skip" and score <= 0.3 if ANY of these apply)
- Post explicitly requires 5+ years of experience
- Role is backend-only, DevOps, ML/AI, data engineering, or QA — not frontend or full-stack
- Role requires on-site work outside India
- Post appears to be generic recruiter spam with no specific role, company, or tech stack context
- Post is not actually a job posting (e.g., a news article, opinion piece, or ad)

## Output
Respond with a single JSON object matching the schema exactly.
- score: float 0.0–1.0 (probability the candidate is a good fit and will get a reply)
- verdict: "send" if score >= 0.7, otherwise "skip"
- reasoning: one sentence
- matched_keywords: array of specific terms from the post that match the candidate's stack
- personalization_hook: if verdict is "send", write a 1–2 sentence personalised opener referencing something concrete from the post (e.g., company name, tech stack mentioned, problem they are solving). If verdict is "skip", return "".`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayBunchID() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Call Gemini with structured JSON output and retry up to 3× on 429/transient errors.
 */
async function callGemini(client, prompt, retries = 3, baseMs = 5000) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await client.models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.2,
        },
      });

      const raw = response.text;
      if (!raw) throw new Error("Empty response from Gemini");

      const parsed = JSON.parse(raw);

      // Clamp score to [0, 1]
      parsed.score = Math.max(0, Math.min(1, Number(parsed.score) || 0));

      // Enforce verdict consistency with score
      if (parsed.score >= 0.7 && parsed.verdict !== "send") parsed.verdict = "send";
      if (parsed.score < 0.7 && parsed.verdict !== "skip") parsed.verdict = "skip";

      return parsed;
    } catch (e) {
      const isRateLimit =
        e.message?.includes("429") ||
        e.message?.toLowerCase().includes("rate") ||
        e.message?.toLowerCase().includes("quota");

      if (attempt < retries - 1) {
        const wait = isRateLimit ? baseMs * Math.pow(2, attempt) + 10000 : baseMs * Math.pow(2, attempt);
        console.warn(`  ⚠️  Gemini error (attempt ${attempt + 1}/${retries}): ${e.message} — retrying in ${(wait / 1000).toFixed(1)}s`);
        await sleep(wait);
      } else {
        throw e;
      }
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const bunchID = BUNCH_ID || todayBunchID();

  console.log(`\n🔍 evaluate-eligibility`);
  console.log(`   bunchID  : ${bunchID}`);
  console.log(`   model    : ${MODEL}`);
  console.log(`   rpm limit: ${RPM_LIMIT} (min interval ${MIN_CALL_INTERVAL_MS}ms)`);
  console.log(`   dry-run  : ${isDryRun}\n`);

  if (!MONGODB_URI) throw new Error("MONGODB_URI is not set");
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");

  const mongo = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  await mongo.connect();

  const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  try {
    const db = mongo.db("Linkedin_scrape");
    const emailsColl = db.collection("Emails");

    // Fetch all scraped (unevaluated) docs for this bunch
    const docs = await emailsColl
      .find({ bunch_id: bunchID, status: "scraped" })
      .toArray();

    console.log(`📋 Found ${docs.length} docs with status="scraped" for bunch "${bunchID}"`);

    if (!docs.length) {
      console.log("ℹ️  Nothing to evaluate. Exiting.");
      return;
    }

    let evaluated = 0;
    let skippedMissingText = 0;
    let errors = 0;

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const label = `[${i + 1}/${docs.length}] ${doc.email}`;

      // Skip docs with no post text — we can't make a meaningful decision
      if (!doc.post_text || doc.post_text.trim().length < 30) {
        console.log(`  ⏭️  ${label} — no post_text, skipping evaluation`);
        skippedMissingText++;

        if (!isDryRun) {
          await emailsColl.updateOne(
            { _id: doc._id },
            {
              $set: {
                status: "evaluated",
                evaluation: {
                  score: 0,
                  verdict: "skip",
                  reasoning: "No post text available for evaluation",
                  matched_keywords: [],
                  personalization_hook: "",
                  evaluatedAt: new Date(),
                },
              },
            }
          );
        }
        continue;
      }

      // Rate-limit: enforce minimum interval between API calls
      const callStart = Date.now();

      try {
        const prompt = buildPrompt(doc);
        const result = await callGemini(genai, prompt);

        console.log(
          `  ${result.verdict === "send" ? "✅" : "⏭️ "} ${label} — score=${result.score.toFixed(2)} verdict=${result.verdict}`
        );
        console.log(`     reasoning: ${result.reasoning}`);
        if (result.matched_keywords?.length) {
          console.log(`     keywords : ${result.matched_keywords.join(", ")}`);
        }
        if (result.personalization_hook) {
          console.log(`     hook     : ${result.personalization_hook}`);
        }

        if (!isDryRun) {
          await emailsColl.updateOne(
            { _id: doc._id },
            {
              $set: {
                status: "evaluated",
                evaluation: {
                  score: result.score,
                  verdict: result.verdict,
                  reasoning: result.reasoning,
                  matched_keywords: result.matched_keywords || [],
                  personalization_hook: result.personalization_hook || "",
                  evaluatedAt: new Date(),
                },
              },
            }
          );
        } else {
          console.log(`     [EVAL_DRY_RUN] Would write evaluation to MongoDB`);
        }

        evaluated++;
      } catch (e) {
        console.error(`  ❌ ${label} — evaluation failed: ${e.message}`);
        errors++;
      }

      // Enforce RPM rate limit — sleep for the remainder of the minimum interval
      const elapsed = Date.now() - callStart;
      const remaining = MIN_CALL_INTERVAL_MS - elapsed;
      if (remaining > 0 && i < docs.length - 1) {
        await sleep(remaining);
      }
    }

    console.log(
      `\n📊 Done — evaluated: ${evaluated}, skipped (no text): ${skippedMissingText}, errors: ${errors}`
    );
    if (errors > 0) process.exit(1);
  } finally {
    await mongo.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
