"use strict";

require("dotenv").config();

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";
const PASS = process.env.DASHBOARD_PASSWORD;
const TRACK_SECRET = process.env.TRACK_SECRET || "";
const TEST_EMAIL = `e2e-test-${Date.now()}@trackmail-test.com`;
const TEST_BUNCH = "e2etest";
const TEST_URL = "https://calendly.com/e2e-test";

let token = "";
let passed = 0;
let failed = 0;

async function req(method, path, body, headers = {}) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", ...headers },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

async function main() {
  console.log(`\n🔬 Trackmail E2E pipeline test`);
  console.log(`   base    : ${BASE}`);
  console.log(`   email   : ${TEST_EMAIL}`);
  console.log(`   bunch   : ${TEST_BUNCH}\n`);

  if (!PASS) { console.error("DASHBOARD_PASSWORD not set"); process.exit(1); }

  console.log("─── 1. Auth ───────────────────────────────────");
  const login = await req("POST", "/auth/login", { password: PASS });
  assert("Login returns 200", login.status === 200, `got ${login.status}`);
  assert("Login returns token", typeof login.data?.token === "string");
  token = login.data?.token || "";

  const authHeaders = { Authorization: `Bearer ${token}` };
  const trackHeaders = { "x-track-secret": TRACK_SECRET };

  console.log("\n─── 2. Seed AlreadySent ────────────────────────");
  const { MongoClient } = require("mongodb");
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("Linkedin_scrape");
  await db.collection("AlreadySent").insertOne({
    email: TEST_EMAIL,
    bunch_id: TEST_BUNCH,
    sentAt: new Date(),
    createdAt: new Date(),
    subject: "E2E Test",
  });
  console.log(`  ✅ Seeded AlreadySent: ${TEST_EMAIL}`);

  console.log("\n─── 3. Simulate Cloudflare events ─────────────");
  const ev1 = await req("POST", "/track-event", { email: TEST_EMAIL, event: "open", bunch_id: TEST_BUNCH }, trackHeaders);
  assert("track-event open → 200", ev1.status === 200, `got ${ev1.status}`);

  const ev2 = await req("POST", "/track-event", { email: TEST_EMAIL, event: "click", bunch_id: TEST_BUNCH, url: TEST_URL }, trackHeaders);
  assert("track-event click → 200", ev2.status === 200, `got ${ev2.status}`);

  const ev3 = await req("POST", "/track-event", { email: TEST_EMAIL, event: "comeback", bunch_id: TEST_BUNCH }, trackHeaders);
  assert("track-event comeback → 200", ev3.status === 200, `got ${ev3.status}`);

  console.log("\n─── 4. /api/insights ────────────────────────────");
  const insights = await req("GET", `/api/insights?bunchId=${TEST_BUNCH}`, null, authHeaders);
  assert("/api/insights → 200", insights.status === 200, `got ${insights.status}`);
  assert("stats.sent >= 1", insights.data?.stats?.sent >= 1);
  assert("stats.openRate > 0", insights.data?.stats?.openRate > 0);
  assert("stats.clickRate > 0", insights.data?.stats?.clickRate > 0);
  assert("opensOverTime is array", Array.isArray(insights.data?.opensOverTime));
  assert("funnel has 4 steps", insights.data?.funnel?.length === 4);

  console.log("\n─── 5. /api/explore/links ──────────────────────");
  const links = await req("GET", `/api/explore/links?bunchId=${TEST_BUNCH}`, null, authHeaders);
  assert("/api/explore/links → 200", links.status === 200, `got ${links.status}`);
  assert("TEST_URL appears in links", (links.data || []).includes(TEST_URL), `got: ${JSON.stringify(links.data)}`);

  console.log("\n─── 6. /api/explore/query ──────────────────────");
  const query1 = await req("POST", "/api/explore/query",
    { bunchId: TEST_BUNCH, conditions: [{ type: "opened", operator: "gte", value: 1 }] },
    authHeaders
  );
  assert("query opened≥1 → 200", query1.status === 200);
  assert("TEST_EMAIL in results", (query1.data || []).some((r) => r.email === TEST_EMAIL));

  const query2 = await req("POST", "/api/explore/query",
    { bunchId: TEST_BUNCH, conditions: [{ type: "clicked_link", url: TEST_URL }] },
    authHeaders
  );
  assert("query clicked_link → 200", query2.status === 200);
  assert("TEST_EMAIL in clicked_link results", (query2.data || []).some((r) => r.email === TEST_EMAIL));

  const query3 = await req("POST", "/api/explore/query",
    { bunchId: TEST_BUNCH, conditions: [{ type: "opened", operator: "never" }] },
    authHeaders
  );
  assert("query never-opened → 200", query3.status === 200);
  assert("TEST_EMAIL NOT in never-opened results", !(query3.data || []).some((r) => r.email === TEST_EMAIL));

  console.log("\n─── 7. /api/explore/timeline ───────────────────");
  const tl = await req("GET",
    `/api/explore/timeline?email=${encodeURIComponent(TEST_EMAIL)}&bunchId=${TEST_BUNCH}`,
    null, authHeaders
  );
  assert("/api/explore/timeline → 200", tl.status === 200);
  assert("timeline has 3 events", (tl.data || []).length === 3, `got ${tl.data?.length}`);
  assert("first event is open",   tl.data?.[0]?.event === "open");
  assert("second event is click", tl.data?.[1]?.event === "click");
  assert("click has url",         tl.data?.[1]?.url === TEST_URL);
  assert("third event is comeback", tl.data?.[2]?.event === "comeback");

  console.log("\n─── Cleanup ─────────────────────────────────────");
  await db.collection("AlreadySent").deleteOne({ email: TEST_EMAIL, bunch_id: TEST_BUNCH });
  await db.collection("TrackingEvents").deleteMany({ email: TEST_EMAIL, bunch_id: TEST_BUNCH });
  await client.close();
  console.log("  ✅ Test data cleaned up");

  console.log(`\n${"─".repeat(50)}`);
  console.log(`📊 Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("🎉 All assertions passed — Cloudflare → MongoDB → API pipeline is working correctly.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
