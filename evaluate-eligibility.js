"use strict";

/**
 * evaluate-eligibility.js
 *
 * Reads today's scraped Emails documents (status == "scraped"), sends ALL of
 * them in a SINGLE Groq API call with JSON mode, and writes the evaluations
 * back to MongoDB (status → "evaluated").
 *
 * Env vars:
 *   MONGODB_URI        — required
 *   GROQ_API_KEY       — required (free at console.groq.com, no credit card)
 *   BUNCH_ID           — optional override (DDMMYY); defaults to today
 *   EVAL_DRY_RUN=true  — log verdicts without writing to MongoDB
 */

const { MongoClient } = require("mongodb");
const Groq = require("groq-sdk");
require("dotenv").config();

const { MONGODB_URI, GROQ_API_KEY, BUNCH_ID, EVAL_DRY_RUN } = process.env;

const isDryRun = EVAL_DRY_RUN === "true";

// llama-3.3-70b-versatile: free tier, excellent at structured JSON, 128K context
const MODEL = "llama-3.3-70b-versatile";

// Truncate post_text per doc to keep the prompt within token limits
const POST_TEXT_LIMIT = 600;

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

function buildBatchPrompt(docs) {
  const entries = docs.map((doc, i) => {
    const postSnippet = (doc.post_text || "").slice(0, POST_TEXT_LIMIT).trim();
    return [
      `--- Entry ${i + 1} ---`,
      `email: ${doc.email}`,
      doc.company ? `company: ${doc.company}` : "",
      doc.role ? `role: ${doc.role}` : "",
      `post_text: ${postSnippet || "(none)"}`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return `You are a job-search assistant. Given a list of recruiter LinkedIn posts and a candidate profile, evaluate each post and decide whether the candidate should send a cold email.

## Candidate profile
${MY_PROFILE}

## Skip rules (set verdict="skip" and score <= 0.3 if ANY apply)
- Post explicitly requires 5+ years of experience
- Role is backend-only, DevOps, ML/AI, data engineering, or QA — not frontend or full-stack
- Role requires on-site work outside India
- Post appears to be generic recruiter spam with no specific role, company, or tech stack context
- Post is not actually a job posting

## Posts to evaluate
${entries.join("\n\n")}

## Output format
Return ONLY a valid JSON array with one object per entry (same order as input). Each object must have exactly these fields:
- "email": string — copy the email address exactly as given
- "score": number — float 0.0–1.0 (fit probability)
- "verdict": string — "send" if score >= 0.7, else "skip"
- "reasoning": string — one sentence
- "matched_keywords": array of strings — terms from the post matching the candidate's stack
- "personalization_hook": string — if verdict is "send", a 1–2 sentence personalised opener referencing something specific from the post; otherwise ""

Example: [{"email":"a@b.com","score":0.85,"verdict":"send","reasoning":"...","matched_keywords":["React"],"personalization_hook":"..."}]`;
}

async function callGroq(client, prompt, retries = 3, baseMs = 5000) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 4096,
      });

      const raw = response.choices[0]?.message?.content;
      if (!raw) throw new Error("Empty response from Groq");

      const parsed = JSON.parse(raw);

      // Groq json_object mode may wrap the array in a key — unwrap if needed
      const results = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.results)
        ? parsed.results
        : Array.isArray(parsed.evaluations)
        ? parsed.evaluations
        : null;

      if (!results) throw new Error(`Expected JSON array from Groq, got: ${JSON.stringify(parsed).slice(0, 200)}`);
      return results;
    } catch (e) {
      const isRateLimit =
        e.status === 429 ||
        e.status === 503 ||
        e.message?.toLowerCase().includes("rate") ||
        e.message?.toLowerCase().includes("quota");

      if (attempt < retries - 1) {
        const wait = isRateLimit
          ? baseMs * Math.pow(2, attempt) + 10000
          : baseMs * Math.pow(2, attempt);
        console.warn(`  ⚠️  Groq error (attempt ${attempt + 1}/${retries}): ${e.message} — retrying in ${(wait / 1000).toFixed(1)}s`);
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
  console.log(`   bunchID : ${bunchID}`);
  console.log(`   model   : ${MODEL}`);
  console.log(`   dry-run : ${isDryRun}\n`);

  if (!MONGODB_URI) throw new Error("MONGODB_URI is not set");
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set");

  const mongo = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  await mongo.connect();

  const groq = new Groq.default({ apiKey: GROQ_API_KEY });

  try {
    const db = mongo.db("Linkedin_scrape");
    const emailsColl = db.collection("Emails");

    const docs = await emailsColl
      .find({ bunch_id: bunchID, status: "scraped" })
      .toArray();

    console.log(`📋 Found ${docs.length} docs with status="scraped" for bunch "${bunchID}"`);

    if (!docs.length) {
      console.log("ℹ️  Nothing to evaluate. Exiting.");
      return;
    }

    // Separate docs with and without post_text
    const withText = docs.filter((d) => d.post_text && d.post_text.trim().length >= 30);
    const withoutText = docs.filter((d) => !d.post_text || d.post_text.trim().length < 30);

    console.log(`   ${withText.length} have post_text, ${withoutText.length} do not\n`);

    // Auto-skip docs with no post_text
    if (withoutText.length && !isDryRun) {
      const ids = withoutText.map((d) => d._id);
      await emailsColl.updateMany(
        { _id: { $in: ids } },
        {
          $set: {
            status: "evaluated",
            evaluation: {
              score: 0,
              verdict: "skip",
              reasoning: "No post text available",
              matched_keywords: [],
              personalization_hook: "",
              evaluatedAt: new Date(),
            },
          },
        }
      );
      console.log(`⏭️  Auto-skipped ${withoutText.length} docs with no post_text`);
    }

    if (!withText.length) {
      console.log("ℹ️  No docs with post_text to evaluate.");
      return;
    }

    // Single Groq call for all docs
    console.log(`🤖 Sending ${withText.length} posts to Groq (${MODEL}) in one request...`);
    const prompt = buildBatchPrompt(withText);
    const results = await callGroq(groq, prompt);

    console.log(`✅ Got ${results.length} evaluations back\n`);

    // Build lookup by email for safety
    const resultsByEmail = new Map(results.map((r) => [r.email, r]));

    let send = 0, skip = 0, errors = 0;

    for (const doc of withText) {
      const result = resultsByEmail.get(doc.email);
      if (!result) {
        console.warn(`  ⚠️  No result returned for ${doc.email}`);
        errors++;
        continue;
      }

      // Clamp and enforce verdict/score consistency
      result.score = Math.max(0, Math.min(1, Number(result.score) || 0));
      if (result.score >= 0.7) result.verdict = "send";
      else result.verdict = "skip";

      const icon = result.verdict === "send" ? "✅" : "⏭️ ";
      console.log(`  ${icon} ${doc.email} — score=${result.score.toFixed(2)} verdict=${result.verdict}`);
      console.log(`     reasoning: ${result.reasoning}`);
      if (result.matched_keywords?.length) console.log(`     keywords : ${result.matched_keywords.join(", ")}`);
      if (result.personalization_hook) console.log(`     hook     : ${result.personalization_hook}`);

      if (result.verdict === "send") send++; else skip++;

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
    }

    console.log(`\n📊 Done — send: ${send}, skip: ${skip}, errors: ${errors}, no-text: ${withoutText.length}`);
    if (errors > 0) process.exit(1);
  } finally {
    await mongo.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
