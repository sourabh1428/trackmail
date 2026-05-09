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
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const { MONGODB_URI, GROQ_API_KEY, GEMINI_API_KEY, BUNCH_ID, EVAL_DRY_RUN } = process.env;

const isDryRun = EVAL_DRY_RUN === "true";

// llama-3.3-70b-versatile: free tier, excellent at structured JSON, 128K context
const MODEL = "llama-3.3-70b-versatile";
const GEMINI_MODEL = "gemini-2.0-flash-lite";

// Truncate post_text per doc to keep the prompt within token limits
const POST_TEXT_LIMIT = 400;

// Full email body generation adds ~200 tokens/doc output; 20 docs ≈ 5K output tokens
const BATCH_SIZE = 20;

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
- "recipient_name": string — infer first name from the email address (e.g. "john.doe@" → "John", "sarah_k@" → "Sarah"; skip initials like "jd@" or role-based addresses like "recruiting@", "hr@", "info@", "careers@") or from the post text if the author signed their name; empty string if uncertain
- "email_subject": string — if verdict="send": 4–7 words, reference the specific company or role from the post; must sound like one human writing to another, NOT a job application. Forbidden words: Application, Resume, Opportunity, Following up, Reaching out. Good examples: "your React role at Groww", "frontend opening — quick note", "saw your post about React hiring", "quick note on your frontend role". If verdict="skip": ""
- "email_preview_text": string — if verdict="send": 85–100 characters that complement (do NOT repeat) the subject and add a concrete detail that makes the email worth opening. Example: "2 yrs React/Node at MoEngage, built tooling for Swiggy — wanted to reach out directly." If verdict="skip": ""
- "email_body": string — if verdict="send": exactly 3 short paragraphs separated by literal \\n\\n. Rules: paragraph 1 — start with "Hi [name]," if name was inferred, else "Hi," — then ONE sentence referencing something specific from the post (company name, tech stack mentioned, role requirement, or something they wrote) — no filler like "Hope this finds you well" or "I came across your post"; paragraph 2 — 2–3 sentences of background pitched to what they need: current role at MoEngage building integrations for enterprise clients like Swiggy and JPMC, previously built Easibill (invoicing SaaS) end-to-end — pick the details most relevant to their post; paragraph 3 — 1–2 sentences direct ask mentioning the specific role type from the post. Do NOT include a sign-off, resume link, or signature — those are added separately. Total body: 120–180 words. If verdict="skip": ""

Example: [{"email":"a@b.com","score":0.85,"verdict":"send","reasoning":"...","matched_keywords":["React"],"recipient_name":"John","email_subject":"your React role at Groww","email_preview_text":"2 yrs React/Node at MoEngage, built tooling for Swiggy — wanted to reach out.","email_body":"Hi John,\\n\\nSaw your post about the React opening at Groww — the focus on consumer-scale product work caught my attention.\\n\\nI'm currently at MoEngage as a Solutions Engineer, building integrations and internal tooling used by enterprise clients like Swiggy and JPMC. Before that I built Easibill end-to-end, an invoicing SaaS covering backend, billing logic, and WhatsApp notifications. My stack is React, TypeScript, and Node.js.\\n\\nI'm actively exploring frontend/full-stack SDE-1 roles and thought it was worth reaching out — happy to chat if my background looks relevant."}]`;
}

async function callGroq(client, prompt, retries = 3, baseMs = 5000) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 8192,
      });

      const raw = response.choices[0]?.message?.content;
      if (!raw) throw new Error("Empty response from Groq");

      const parsed = JSON.parse(raw);

      // Groq json_object mode may return: a bare array, a wrapper object with
      // an array value, or (for single-doc batches) a flat evaluation object.
      let results = null;
      if (Array.isArray(parsed)) {
        results = parsed;
      } else if (parsed && typeof parsed.email === "string") {
        // Flat single-evaluation object — wrap it
        results = [parsed];
      } else {
        // Pick the first key whose value is an array of objects
        for (const val of Object.values(parsed)) {
          if (Array.isArray(val) && val.some((x) => x && typeof x === "object" && typeof x.email === "string")) {
            results = val;
            break;
          }
        }
      }

      if (!results) throw new Error(`Expected JSON array from Groq, got: ${JSON.stringify(parsed).slice(0, 200)}`);
      // Filter out any non-object junk elements the LLM may hallucinate
      return results.filter((r) => r && typeof r === "object" && typeof r.email === "string");
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

async function callGemini(prompt, retries = 3, baseMs = 5000) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set — cannot use Gemini fallback");
  const genai = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genai.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 8192 },
  });

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const raw = result.response.text();
      if (!raw) throw new Error("Empty response from Gemini");

      const parsed = JSON.parse(raw);
      let results = null;
      if (Array.isArray(parsed)) {
        results = parsed;
      } else if (parsed && typeof parsed.email === "string") {
        results = [parsed];
      } else {
        for (const val of Object.values(parsed)) {
          if (Array.isArray(val) && val.some((x) => x && typeof x === "object" && typeof x.email === "string")) {
            results = val;
            break;
          }
        }
      }

      if (!results) throw new Error(`Expected JSON array from Gemini, got: ${JSON.stringify(parsed).slice(0, 200)}`);
      return results.filter((r) => r && typeof r === "object" && typeof r.email === "string");
    } catch (e) {
      const isRateLimit =
        e.status === 429 ||
        e.message?.toLowerCase().includes("rate") ||
        e.message?.toLowerCase().includes("quota");

      if (attempt < retries - 1) {
        const wait = isRateLimit
          ? baseMs * Math.pow(2, attempt) + 10000
          : baseMs * Math.pow(2, attempt);
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
  console.log(`   bunchID : ${bunchID}`);
  console.log(`   model   : ${MODEL}`);
  console.log(`   dry-run : ${isDryRun}\n`);

  if (!MONGODB_URI) throw new Error("MONGODB_URI is not set");
  if (!GROQ_API_KEY && !GEMINI_API_KEY) throw new Error("Either GROQ_API_KEY or GEMINI_API_KEY must be set");
  if (!GROQ_API_KEY) console.warn("⚠️  GROQ_API_KEY not set — will use Gemini for all batches");

  const mongo = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  await mongo.connect();

  const groq = GROQ_API_KEY ? new Groq.default({ apiKey: GROQ_API_KEY }) : null;

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
              recipient_name: "",
              email_subject: "",
              email_preview_text: "",
              email_body: "",
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

    // Chunk docs to stay within free-tier TPM limits
    const chunks = [];
    for (let i = 0; i < withText.length; i += BATCH_SIZE) {
      chunks.push(withText.slice(i, i + BATCH_SIZE));
    }
    console.log(`🤖 Sending ${withText.length} posts to Groq (${MODEL}) in ${chunks.length} batch(es)...`);

    const allResults = [];
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) {
        console.log(`   ⏳ Waiting 4s before batch ${i + 1}/${chunks.length}...`);
        await sleep(4000);
      }
      console.log(`   Batch ${i + 1}/${chunks.length}: ${chunks[i].length} docs`);
      let batchResults;
      try {
        if (!groq) throw new Error("Groq client not initialized (no GROQ_API_KEY)");
        batchResults = await callGroq(groq, buildBatchPrompt(chunks[i]));
      } catch (groqErr) {
        console.warn(`  ⚠️  Groq exhausted for batch ${i + 1}: ${groqErr.message}`);
        console.log(`  🔄 Falling back to Gemini (${GEMINI_MODEL})...`);
        batchResults = await callGemini(buildBatchPrompt(chunks[i]));
      }
      allResults.push(...batchResults);
    }

    console.log(`✅ Got ${allResults.length} evaluations back\n`);

    // Match by index (LLM preserves order per prompt); email lookup as fallback
    const resultsByEmail = new Map(allResults.map((r) => [r.email, r]));

    let send = 0, skip = 0, errors = 0;

    for (let idx = 0; idx < withText.length; idx++) {
      const doc = withText[idx];
      const result = allResults[idx] ?? resultsByEmail.get(doc.email);
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
      if (result.email_subject) console.log(`     subject  : ${result.email_subject}`);
      if (result.email_preview_text) console.log(`     preview  : ${result.email_preview_text}`);
      if (result.email_body) console.log(`     body     : ${result.email_body.slice(0, 100)}...`);

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
                recipient_name: result.recipient_name || "",
                email_subject: result.email_subject || "",
                email_preview_text: result.email_preview_text || "",
                email_body: result.email_body || "",
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
