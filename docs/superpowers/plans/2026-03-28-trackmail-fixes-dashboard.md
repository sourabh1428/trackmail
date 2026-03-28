# Trackmail — Bug Fixes + Analytics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the existing trackmail pipeline against the identified security/reliability issues and ship a React analytics dashboard (Vercel) backed by the existing Express API (Render) showing emails sent, opened, clicked, and came back, with an in-browser template editor.

**Architecture:** Express API is refactored into route modules (`routes/`, `middleware/`, `db.js`) for clean separation; a React/Vite dashboard in `dashboard/` proxies all API calls to Express; the existing Cloudflare Worker is updated to POST tracking events to Express, which persists them in MongoDB `TrackingEvents`.

**Tech Stack:** Node.js 20, Express 4, MongoDB 6, jsonwebtoken, Jest + supertest (backend tests), React 18, Vite, Tailwind CSS v3, Recharts, React Router v6, Axios (frontend)

---

## File Map

### Modified
- `send-daily-emails.js` — TLS fix, email regex, retry logic, active template from MongoDB, bid in tracking URLs
- `server.js` — stripped to entry point: env validation, middleware mount, router mount, graceful shutdown
- `mailer.js` — add `transporter.verify()` at startup
- `.gitignore` — add scraper session/debug files
- `package.json` — remove unused deps, add jsonwebtoken + jest + supertest
- `scraper/pages/search_page.py` — accept shared `mongo_client` param
- `scraper/pages/login_page.py` — screenshots behind `DEBUG_SCREENSHOTS` env var
- `scraper/scraper.py` — create one shared `MongoClient`, pass to `LinkedInSearchPage`

### Created
- `db.js` — MongoDB singleton: `connectDB()`, `getDB()`, `closeDB()`
- `middleware/auth.js` — JWT Bearer verification middleware
- `middleware/trackSecret.js` — `x-track-secret` header verification middleware
- `routes/auth.js` — `POST /auth/login`
- `routes/tracking.js` — `POST /track-event`
- `routes/stats.js` — `GET /api/bunches`, `GET /api/stats`, `GET /api/events`
- `routes/templates.js` — CRUD for `EmailTemplates` collection
- `routes/email.js` — existing send routes (moved from server.js)
- `tests/auth.test.js` — auth route tests
- `tests/tracking.test.js` — track-event route tests
- `tests/stats.test.js` — stats route tests
- `.env.example` — updated with new vars
- `cloudflare-worker.js` — complete updated worker code (manual deploy)
- `dashboard/` — full React/Vite app (see dashboard section)

---

## Phase 1: Safe Cleanup

### Task 1: .gitignore + package.json

**Files:**
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: Add scraper artifacts to .gitignore**

Open `.gitignore`, append at the bottom:
```
# Scraper session + debug
scraper/linkedin_context.json
scraper/debug_*.png
scraper/*.csv
```

- [ ] **Step 2: Remove unused dependencies and add new ones**

Run:
```bash
cd C:/Users/spsou/Documents/trackmail
npm uninstall ioredis redis axios
npm install jsonwebtoken
npm install --save-dev jest supertest
```

Expected: `package.json` `dependencies` no longer has `ioredis`, `redis`, `axios`. Has `jsonwebtoken`. `devDependencies` has `jest` and `supertest`.

- [ ] **Step 3: Add test script and jest config to package.json**

Open `package.json`. Replace the `"scripts"` section and add `"jest"` config:
```json
"scripts": {
  "test": "jest",
  "start": "node server.js",
  "dev": "nodemon server.js"
},
"jest": {
  "testEnvironment": "node",
  "testMatch": ["**/tests/**/*.test.js"]
},
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore package.json package-lock.json
git commit -m "chore: remove unused deps, add jsonwebtoken+jest, gitignore scraper artifacts"
```

---

### Task 2: Fix mailer.js

**Files:**
- Modify: `mailer.js`

- [ ] **Step 1: Add transporter.verify() call**

Replace the entire `mailer.js` with:
```js
"use strict";

const nodemailer = require("nodemailer");

const { EMAIL_USER, EMAIL_PASS } = process.env;

if (!EMAIL_USER || !EMAIL_PASS) {
  console.warn("[mailer] EMAIL_USER/EMAIL_PASS not set. Emails will fail until provided.");
}

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
});

// Verify SMTP credentials at startup — fail fast rather than on first send
transporter.verify().then(() => {
  console.log("[mailer] SMTP connection verified");
}).catch(err => {
  console.error("[mailer] SMTP verification failed:", err.message);
  process.exit(1);
});

async function sendEmail({ to, subject, text, html, attachments }) {
  if (!to) throw new Error("'to' is required");
  if (!subject) throw new Error("'subject' is required");
  return transporter.sendMail({ from: EMAIL_USER, to, subject, text, html, attachments });
}

module.exports = { transporter, sendEmail };
```

- [ ] **Step 2: Commit**

```bash
git add mailer.js
git commit -m "fix: add SMTP transporter.verify() at startup for fail-fast credential check"
```

---

### Task 3: Fix send-daily-emails.js

**Files:**
- Modify: `send-daily-emails.js`

- [ ] **Step 1: Remove TLS flag, fix email regex, fix retry, add bid to tracking, load active template**

Replace the entire `send-daily-emails.js` with:
```js
"use strict";

const nodemailer = require("nodemailer");
const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const { MONGODB_URI, EMAIL_USER, EMAIL_PASS, BUNCH_ID, DRY_RUN } = process.env;

function todayBunchID() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
}

const TEMPLATE_PATH = path.join(__dirname, "test.html");
const TRACKING_BASE = "https://test-open.sppathak1428.workers.dev";

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

function addTracking(html, email, bunchId) {
  const enc = encodeURIComponent(email);
  const bid = encodeURIComponent(bunchId);
  const pixel = `<img src="${TRACKING_BASE}/track-open?email=${enc}&bid=${bid}" width="1" height="1" style="position:absolute;left:-9999px;" alt="" />`;

  let out = html.replace(/<a\s+(?:[^>]*?\s+)?href=(['"])(.*?)\1/gi, (match, q, url) => {
    if (url.includes("/track-link") || url.startsWith("#") || url.startsWith("mailto:")) return match;
    const tracked = `${TRACKING_BASE}/track-link?email=${enc}&bid=${bid}&url=${encodeURIComponent(url)}`;
    return `<a href=${q}${tracked}${q}`;
  });

  return out.includes("</body>")
    ? out.replace("</body>", `${pixel}</body>`)
    : out + pixel;
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
  const db = mongo.db("Linkedin_scrape");
  const emailsColl = db.collection("Emails");
  const alreadySentCol = db.collection("AlreadySent");

  await alreadySentCol.createIndex({ email: 1 }, { unique: true }).catch(() => {});

  const users = await emailsColl.find({ bunch_id: bunchID }).toArray();
  console.log(`📋 Found ${users.length} recipients for bunch "${bunchID}"`);

  if (!users.length) {
    console.log("ℹ️  Nothing to send. Exiting.");
    await mongo.close();
    return;
  }

  const validEmails = [...new Set(
    users.map(u => u.email).filter(e => e && EMAIL_REGEX.test(e))
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
    await mongo.close();
    return;
  }

  const transporter = nodemailer.createTransport({
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
  let success = 0, failed = 0;

  for (const email of toSend) {
    const html = addTracking(template, email, bunchID);

    if (isDry) {
      console.log(`  [DRY] would send → ${email}`);
      success++;
      continue;
    }

    try {
      await retry(() => transporter.sendMail({ from: EMAIL_USER, to: email, subject: SUBJECT, html }));

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

  transporter.close();
  await mongo.close();

  console.log(`\n📊 Done — success: ${success}, failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Verify dry run still works**

```bash
cd C:/Users/spsou/Documents/trackmail
DRY_RUN=true node send-daily-emails.js
```

Expected: prints `dry-run : true` and exits cleanly (either "Nothing to send" or lists DRY sends).

- [ ] **Step 3: Commit**

```bash
git add send-daily-emails.js
git commit -m "fix: remove TLS flag, fix email regex, fix retry, add bid to tracking URLs, load active template from MongoDB"
```

---

## Phase 2: Backend Hardening

### Task 4: Fix scraper — shared MongoDB connection

**Files:**
- Modify: `scraper/pages/search_page.py`
- Modify: `scraper/pages/login_page.py`
- Modify: `scraper/scraper.py`

- [ ] **Step 1: Update LinkedInSearchPage to accept a shared client**

In `scraper/pages/search_page.py`, replace `__init__` (lines 15–47):
```python
def __init__(self, page, mongo_client=None):
    super().__init__(page)
    self.bunch_id = datetime.now().strftime("%d%m%y")

    if mongo_client is not None:
        # Use the shared client passed in — do NOT create a new one
        self.client = None  # not owned by this instance
        _client = mongo_client
    else:
        # Fallback: create own client (for standalone use only)
        mongodb_uri = os.getenv('MONGODB_URI')
        if not mongodb_uri:
            print("⚠️ Warning: MONGODB_URI not set.")
        try:
            self.client = MongoClient(mongodb_uri)
            self.client.admin.command('ping')
            print("✅ MongoDB connection successful (standalone)")
            _client = self.client
        except Exception as e:
            print(f"❌ MongoDB connection failed: {e}")
            self.client = None
            self.collection = None
            print(f"Generated bunch ID: {self.bunch_id}")
            return

    db_name = os.getenv('MONGODB_DATABASE', 'Linkedin_scrape')
    collection_name = os.getenv('MONGODB_COLLECTION', 'Emails')
    self.db = _client[db_name]
    self.collection = self.db[collection_name]
    print(f"Generated bunch ID: {self.bunch_id}")
```

Also replace `__del__` (last method) to only close if we own the client:
```python
def __del__(self):
    """Cleanup MongoDB connection only if we own it"""
    if hasattr(self, 'client') and self.client:
        try:
            self.client.close()
        except:
            pass
```

- [ ] **Step 2: Guard debug screenshots in login_page.py**

In `scraper/pages/login_page.py`, line 77 replace:
```python
            self.page.screenshot(path="debug_login_page.png")
            print("Screenshot saved as debug_login_page.png")
```
with:
```python
            if os.getenv('DEBUG_SCREENSHOTS'):
                self.page.screenshot(path="debug_login_page.png")
                print("Screenshot saved as debug_login_page.png")
```

Line 127, replace:
```python
        self.page.screenshot(path="debug_after_login.png")
        print("Screenshot saved as debug_after_login.png")
```
with:
```python
        if os.getenv('DEBUG_SCREENSHOTS'):
            self.page.screenshot(path="debug_after_login.png")
            print("Screenshot saved as debug_after_login.png")
```

Also add `import os` at the top of `login_page.py` (it currently doesn't import os).

- [ ] **Step 3: Update scraper.py to use one shared MongoClient**

In `scraper/scraper.py`, add at the top after the existing imports:
```python
from pymongo import MongoClient as PyMongoClient
```

In `scrape_multiple_links`, before the `states = []` block (around line 69), add:
```python
            # Create ONE shared MongoDB client for the entire scrape session
            mongodb_uri = os.getenv('MONGODB_URI')
            shared_mongo = None
            if mongodb_uri:
                try:
                    shared_mongo = PyMongoClient(mongodb_uri)
                    shared_mongo.admin.command('ping')
                    print("✅ Shared MongoDB client created for scrape session")
                except Exception as e:
                    print(f"⚠️ MongoDB connection failed: {e}. Data will only be saved to CSV.")
```

In the `states` setup loop (lines 70–80), add `"search_page": None` to each state dict:
```python
            states = []
            for page, link, tab_index in pages:
                states.append({
                    "page": page,
                    "link": link,
                    "tab_index": tab_index,
                    "profiles": set(),
                    "previous_height": None,
                    "no_data_count": 0,
                    "scroll_attempts": 0,
                    "done": False,
                    "search_page": LinkedInSearchPage(page, shared_mongo),  # one instance per tab
                })
```

Replace the per-email instantiation at line 143:
```python
                            LinkedInSearchPage(page).save_profile_to_mongodb(email)
```
with:
```python
                            s["search_page"].save_profile_to_mongodb(email)
```

In the `finally` block, after the tab-closing loop, add:
```python
                if shared_mongo:
                    try:
                        shared_mongo.close()
                        print("🔒 Shared MongoDB client closed")
                    except Exception as e:
                        print(f"⚠️ Error closing MongoDB client: {e}")
```

- [ ] **Step 4: Commit**

```bash
git add scraper/pages/search_page.py scraper/pages/login_page.py scraper/scraper.py
git commit -m "fix: shared MongoClient in scraper (was creating one per email), guard debug screenshots"
```

---

### Task 5: Create db.js — MongoDB singleton

**Files:**
- Create: `db.js`

- [ ] **Step 1: Write db.js**

Create `db.js`:
```js
"use strict";

const { MongoClient } = require("mongodb");

let client;
let db;

async function connectDB() {
  if (db) return db;
  client = new MongoClient(process.env.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 20000,
  });
  await client.connect();
  db = client.db("Linkedin_scrape");

  // Ensure indexes on startup
  await db.collection("AlreadySent").createIndex({ email: 1 }, { unique: true }).catch(() => {});
  await db.collection("TrackingEvents").createIndex({ email: 1, event: 1 }).catch(() => {});
  await db.collection("TrackingEvents").createIndex({ bunch_id: 1 }).catch(() => {});

  console.log("[db] connected to MongoDB");
  return db;
}

function getDB() {
  if (!db) throw new Error("Database not connected. Call connectDB() first.");
  return db;
}

async function closeDB() {
  if (client) {
    await client.close();
    db = null;
    client = null;
    console.log("[db] connection closed");
  }
}

module.exports = { connectDB, getDB, closeDB };
```

- [ ] **Step 2: Commit**

```bash
git add db.js
git commit -m "feat: add db.js MongoDB singleton with index setup"
```

---

### Task 6: Auth middleware + track-secret middleware

**Files:**
- Create: `middleware/auth.js`
- Create: `middleware/trackSecret.js`

- [ ] **Step 1: Create middleware directory and auth.js**

```bash
mkdir -p middleware
```

Create `middleware/auth.js`:
```js
"use strict";

const jwt = require("jsonwebtoken");

function verifyJWT(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { verifyJWT };
```

- [ ] **Step 2: Create middleware/trackSecret.js**

Create `middleware/trackSecret.js`:
```js
"use strict";

function verifyTrackSecret(req, res, next) {
  const secret = req.headers["x-track-secret"];
  if (!secret || secret !== process.env.TRACK_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

module.exports = { verifyTrackSecret };
```

- [ ] **Step 3: Commit**

```bash
git add middleware/
git commit -m "feat: add JWT auth middleware and track-secret middleware"
```

---

## Phase 3: New Backend Routes

### Task 7: Auth route + tests

**Files:**
- Create: `routes/auth.js`
- Create: `tests/auth.test.js`

- [ ] **Step 1: Write the failing tests first**

Create `tests/auth.test.js`:
```js
"use strict";

const request = require("supertest");
const express = require("express");

process.env.JWT_SECRET = "test-jwt-secret-32chars-minimum!!";
process.env.DASHBOARD_PASSWORD = "correct-horse-battery";

const authRouter = require("../routes/auth");

const app = express();
app.use(express.json());
app.use("/auth", authRouter);

describe("POST /auth/login", () => {
  it("returns a JWT token on correct password", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ password: "correct-horse-battery" });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.token.split(".").length).toBe(3); // valid JWT structure
  });

  it("returns 401 on wrong password", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it("returns 401 on missing password", async () => {
    const res = await request(app).post("/auth/login").send({});
    expect(res.status).toBe(401);
  });

  it("returns 400 on missing body", async () => {
    const res = await request(app).post("/auth/login");
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (routes/auth.js does not exist yet)**

```bash
cd C:/Users/spsou/Documents/trackmail
npx jest tests/auth.test.js
```

Expected: `Cannot find module '../routes/auth'`

- [ ] **Step 3: Create routes/auth.js**

```bash
mkdir -p routes
```

Create `routes/auth.js`:
```js
"use strict";

const router = require("express").Router();
const jwt = require("jsonwebtoken");

router.post("/login", (req, res) => {
  const { password } = req.body || {};
  if (!password || password !== process.env.DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: "Invalid password" });
  }
  const token = jwt.sign(
    { sub: "dashboard" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
  return res.json({ token });
});

module.exports = router;
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest tests/auth.test.js
```

Expected:
```
PASS tests/auth.test.js
  POST /auth/login
    ✓ returns a JWT token on correct password
    ✓ returns 401 on wrong password
    ✓ returns 401 on missing password
    ✓ returns 400 on missing body
```

- [ ] **Step 5: Commit**

```bash
git add routes/auth.js tests/auth.test.js
git commit -m "feat: add /auth/login route with JWT (TDD)"
```

---

### Task 8: Tracking route + tests

**Files:**
- Create: `routes/tracking.js`
- Create: `tests/tracking.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/tracking.test.js`:
```js
"use strict";

const request = require("supertest");
const express = require("express");

process.env.TRACK_SECRET = "track-secret-test-value";

// Mock db.js before requiring the route
jest.mock("../db", () => ({
  getDB: jest.fn(() => ({
    collection: jest.fn(() => ({
      insertOne: jest.fn().mockResolvedValue({ insertedId: "abc123" }),
    })),
  })),
}));

const trackingRouter = require("../routes/tracking");

const app = express();
app.use(express.json());
app.use("/", trackingRouter);

describe("POST /track-event", () => {
  it("returns 403 without track secret header", async () => {
    const res = await request(app)
      .post("/track-event")
      .send({ email: "a@b.com", event: "open", bunch_id: "280326" });
    expect(res.status).toBe(403);
  });

  it("accepts a valid open event", async () => {
    const res = await request(app)
      .post("/track-event")
      .set("x-track-secret", "track-secret-test-value")
      .send({ email: "a@b.com", event: "open", bunch_id: "280326" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("accepts a valid click event with url", async () => {
    const res = await request(app)
      .post("/track-event")
      .set("x-track-secret", "track-secret-test-value")
      .send({ email: "a@b.com", event: "click", bunch_id: "280326", url: "https://example.com" });
    expect(res.status).toBe(200);
  });

  it("returns 400 on invalid event type", async () => {
    const res = await request(app)
      .post("/track-event")
      .set("x-track-secret", "track-secret-test-value")
      .send({ email: "a@b.com", event: "bogus", bunch_id: "280326" });
    expect(res.status).toBe(400);
  });

  it("returns 400 on missing required fields", async () => {
    const res = await request(app)
      .post("/track-event")
      .set("x-track-secret", "track-secret-test-value")
      .send({ email: "a@b.com" }); // missing event and bunch_id
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx jest tests/tracking.test.js
```

Expected: `Cannot find module '../routes/tracking'`

- [ ] **Step 3: Create routes/tracking.js**

Create `routes/tracking.js`:
```js
"use strict";

const router = require("express").Router();
const { verifyTrackSecret } = require("../middleware/trackSecret");
const { getDB } = require("../db");

const VALID_EVENTS = new Set(["open", "click", "comeback"]);

router.post("/track-event", verifyTrackSecret, async (req, res) => {
  const { email, event, url, bunch_id } = req.body || {};

  if (!email || !event || !bunch_id) {
    return res.status(400).json({ error: "email, event, and bunch_id are required" });
  }
  if (!VALID_EVENTS.has(event)) {
    return res.status(400).json({ error: `Invalid event type. Must be one of: ${[...VALID_EVENTS].join(", ")}` });
  }

  try {
    const doc = { email, event, bunch_id, timestamp: new Date() };
    if (url) doc.url = url;
    const ip = req.headers["cf-connecting-ip"] || req.ip;
    if (ip) doc.ip = ip;

    await getDB().collection("TrackingEvents").insertOne(doc);
    return res.json({ ok: true });
  } catch (e) {
    console.error("[track-event]", e.message);
    return res.status(500).json({ ok: false, error: "Internal error" });
  }
});

module.exports = router;
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest tests/tracking.test.js
```

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add routes/tracking.js tests/tracking.test.js
git commit -m "feat: add /track-event route with secret auth (TDD)"
```

---

### Task 9: Stats routes + tests

**Files:**
- Create: `routes/stats.js`
- Create: `tests/stats.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/stats.test.js`:
```js
"use strict";

const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "test-jwt-secret-32chars-minimum!!";

// Mock db before requiring route
jest.mock("../db", () => ({
  getDB: jest.fn(),
}));

const { getDB } = require("../db");
const statsRouter = require("../routes/stats");

const app = express();
app.use(express.json());
app.use("/", statsRouter);

function makeToken() {
  return jwt.sign({ sub: "dashboard" }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

describe("GET /api/bunches", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/bunches");
    expect(res.status).toBe(401);
  });

  it("returns list of bunches", async () => {
    const mockAggregate = jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        { bunch_id: "280326", sent: 42 },
        { bunch_id: "270326", sent: 38 },
      ]),
    });
    getDB.mockReturnValue({ collection: jest.fn(() => ({ aggregate: mockAggregate })) });

    const res = await request(app)
      .get("/api/bunches")
      .set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].bunch_id).toBe("280326");
  });
});

describe("GET /api/stats", () => {
  it("returns 400 without bunchId", async () => {
    getDB.mockReturnValue({});
    const res = await request(app)
      .get("/api/stats")
      .set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(400);
  });

  it("returns correct stats for a bunchId", async () => {
    const mockCollection = jest.fn((name) => {
      if (name === "AlreadySent") return { countDocuments: jest.fn().mockResolvedValue(50) };
      if (name === "TrackingEvents") return {
        aggregate: jest.fn().mockReturnValue({
          toArray: jest.fn()
            .mockResolvedValueOnce([
              { _id: "open", count: 10 },
              { _id: "click", count: 5 },
            ])
            .mockResolvedValueOnce([{ total: 2 }]),
        }),
      };
    });
    getDB.mockReturnValue({ collection: mockCollection });

    const res = await request(app)
      .get("/api/stats?bunchId=280326")
      .set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(50);
    expect(res.body.opens).toBe(10);
    expect(res.body.clicks).toBe(5);
    expect(res.body.openRate).toBe(20); // 10/50 * 100
    expect(res.body.clickRate).toBe(10); // 5/50 * 100
    expect(res.body.cameBack).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx jest tests/stats.test.js
```

Expected: `Cannot find module '../routes/stats'`

- [ ] **Step 3: Create routes/stats.js**

Create `routes/stats.js`:
```js
"use strict";

const router = require("express").Router();
const { verifyJWT } = require("../middleware/auth");
const { getDB } = require("../db");

router.use(verifyJWT);

// GET /api/bunches
// Returns all bunch_ids with sent counts, newest first
router.get("/api/bunches", async (req, res) => {
  try {
    const bunches = await getDB().collection("AlreadySent").aggregate([
      { $group: { _id: "$bunch_id", sent: { $sum: 1 } } },
      { $sort: { _id: -1 } },
      { $project: { _id: 0, bunch_id: "$_id", sent: 1 } },
    ]).toArray();
    return res.json(bunches);
  } catch (e) {
    console.error("[api/bunches]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/stats?bunchId=DDMMYY
router.get("/api/stats", async (req, res) => {
  const { bunchId } = req.query;
  if (!bunchId) return res.status(400).json({ error: "bunchId query param required" });

  try {
    const db = getDB();

    const [sent, eventGroups, comebackData] = await Promise.all([
      db.collection("AlreadySent").countDocuments({ bunch_id: bunchId }),

      db.collection("TrackingEvents").aggregate([
        { $match: { bunch_id: bunchId } },
        { $group: { _id: { email: "$email", event: "$event" } } },
        { $group: { _id: "$_id.event", count: { $sum: 1 } } },
      ]).toArray(),

      // "came back" = clicked more than once (distinct emails with >1 click)
      db.collection("TrackingEvents").aggregate([
        { $match: { bunch_id: bunchId, event: "click" } },
        { $group: { _id: "$email", count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $count: "total" },
      ]).toArray(),
    ]);

    const eventMap = {};
    for (const e of eventGroups) eventMap[e._id] = e.count;

    const opens = eventMap["open"] || 0;
    const clicks = eventMap["click"] || 0;
    const cameBack = comebackData[0]?.total || 0;

    return res.json({
      sent,
      opens,
      clicks,
      cameBack,
      openRate: sent > 0 ? Math.round((opens / sent) * 100) : 0,
      clickRate: sent > 0 ? Math.round((clicks / sent) * 100) : 0,
    });
  } catch (e) {
    console.error("[api/stats]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/events?bunchId=DDMMYY
// Returns per-recipient row: { email, sentAt, opened, clicked, cameBack }
router.get("/api/events", async (req, res) => {
  const { bunchId } = req.query;
  if (!bunchId) return res.status(400).json({ error: "bunchId query param required" });

  try {
    const db = getDB();

    const [sentDocs, trackDocs] = await Promise.all([
      db.collection("AlreadySent")
        .find({ bunch_id: bunchId })
        .project({ email: 1, sentAt: 1, _id: 0 })
        .toArray(),
      db.collection("TrackingEvents")
        .find({ bunch_id: bunchId })
        .project({ email: 1, event: 1, timestamp: 1, _id: 0 })
        .toArray(),
    ]);

    const map = {};
    for (const s of sentDocs) {
      map[s.email] = { email: s.email, sentAt: s.sentAt, opened: false, clicked: false, clickCount: 0 };
    }
    for (const t of trackDocs) {
      if (!map[t.email]) continue;
      if (t.event === "open") map[t.email].opened = true;
      if (t.event === "click") {
        map[t.email].clicked = true;
        map[t.email].clickCount += 1;
      }
    }

    const rows = Object.values(map).map(r => ({
      email: r.email,
      sentAt: r.sentAt,
      opened: r.opened,
      clicked: r.clicked,
      cameBack: r.clickCount > 1,
    }));

    return res.json(rows);
  } catch (e) {
    console.error("[api/events]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest tests/stats.test.js
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add routes/stats.js tests/stats.test.js
git commit -m "feat: add /api/bunches, /api/stats, /api/events routes (TDD)"
```

---

### Task 10: Templates route

**Files:**
- Create: `routes/templates.js`

- [ ] **Step 1: Create routes/templates.js**

Create `routes/templates.js`:
```js
"use strict";

const router = require("express").Router();
const { ObjectId } = require("mongodb");
const fs = require("fs");
const path = require("path");
const { verifyJWT } = require("../middleware/auth");
const { getDB } = require("../db");

router.use(verifyJWT);

// GET /api/templates — list all (without html body, for performance)
router.get("/api/templates", async (req, res) => {
  try {
    const templates = await getDB().collection("EmailTemplates")
      .find({}, { projection: { html: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
    return res.json(templates);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/templates/active — return full HTML of active template
// Falls back to test.html if no active template in MongoDB
router.get("/api/templates/active", async (req, res) => {
  try {
    const tmpl = await getDB().collection("EmailTemplates").findOne({ isActive: true });
    if (tmpl) return res.json({ _id: tmpl._id, name: tmpl.name, html: tmpl.html });
    // Fallback: serve test.html
    const html = fs.readFileSync(path.join(__dirname, "../test.html"), "utf8");
    return res.json({ _id: null, name: "default (test.html)", html });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/templates/:id — fetch single template with html
router.get("/api/templates/:id", async (req, res) => {
  try {
    const tmpl = await getDB().collection("EmailTemplates").findOne({ _id: new ObjectId(req.params.id) });
    if (!tmpl) return res.status(404).json({ error: "Not found" });
    return res.json(tmpl);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/templates — create new template
router.post("/api/templates", async (req, res) => {
  const { name, html } = req.body || {};
  if (!name || !html) return res.status(400).json({ error: "name and html are required" });
  try {
    const result = await getDB().collection("EmailTemplates").insertOne({
      name,
      html,
      isActive: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return res.status(201).json({ _id: result.insertedId, name });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// PUT /api/templates/:id — update name or html
router.put("/api/templates/:id", async (req, res) => {
  const { name, html } = req.body || {};
  if (!name && !html) return res.status(400).json({ error: "name or html is required" });
  try {
    const update = { updatedAt: new Date() };
    if (name) update.name = name;
    if (html) update.html = html;
    const result = await getDB().collection("EmailTemplates").updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: update }
    );
    if (!result.matchedCount) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// DELETE /api/templates/:id — cannot delete the active template
router.delete("/api/templates/:id", async (req, res) => {
  try {
    const col = getDB().collection("EmailTemplates");
    const tmpl = await col.findOne({ _id: new ObjectId(req.params.id) });
    if (!tmpl) return res.status(404).json({ error: "Not found" });
    if (tmpl.isActive) return res.status(400).json({ error: "Cannot delete the active template. Activate another template first." });
    await col.deleteOne({ _id: new ObjectId(req.params.id) });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/templates/:id/activate — atomic activate
router.post("/api/templates/:id/activate", async (req, res) => {
  try {
    const col = getDB().collection("EmailTemplates");
    const tmpl = await col.findOne({ _id: new ObjectId(req.params.id) });
    if (!tmpl) return res.status(404).json({ error: "Not found" });
    // Deactivate all, then activate this one
    await col.updateMany({}, { $set: { isActive: false } });
    await col.updateOne({ _id: new ObjectId(req.params.id) }, { $set: { isActive: true, updatedAt: new Date() } });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add routes/templates.js
git commit -m "feat: add EmailTemplates CRUD routes"
```

---

### Task 11: Email routes (move existing send routes)

**Files:**
- Create: `routes/email.js`

- [ ] **Step 1: Create routes/email.js with existing send logic**

Create `routes/email.js`:
```js
"use strict";

const router = require("express").Router();
const { verifyJWT } = require("../middleware/auth");
const { sendEmail } = require("../mailer");
const { getDB } = require("../db");

router.use(verifyJWT);

async function retry(fn, { retries = 3, baseDelayMs = 500 }) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt > retries) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

// POST /send-email
router.post("/send-email", async (req, res) => {
  const { to, subject, html, text, trackId } = req.body || {};
  if (!to || !subject || (!html && !text)) {
    return res.status(400).json({ error: "Missing required fields: to, subject, html|text" });
  }
  try {
    const result = await retry(() => sendEmail({ to, subject, html, text }), { retries: 3, baseDelayMs: 1000 });

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

// POST /send-bulk-emails
router.post("/send-bulk-emails", async (req, res) => {
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
      if (!email) { failCount++; results.push({ email: null, status: "fail", reason: "Missing email field" }); continue; }
      if (alreadySentSet.has(email)) { results.push({ email, status: "skipped", reason: "Already sent" }); continue; }

      try {
        const info = await retry(
          () => sendEmail({ to: email, subject, html: htmlTemplate, text: textTemplate }),
          { retries: 3, baseDelayMs: 1000 }
        );
        await db.collection("AlreadySent").updateOne(
          { bunch_id: bunchID, email },
          { $set: { bunch_id: bunchID, email, subject, sentAt: new Date(), messageId: info.messageId } },
          { upsert: true }
        );
        successCount++;
        results.push({ email, status: "success" });
      } catch (err) {
        failCount++;
        results.push({ email, status: "fail", error: err.message });
      }
    }

    return res.json({ ok: true, bunchID, sent: successCount, failed: failCount, total: recipients.length, results });
  } catch (e) {
    console.error(`[send-bulk-emails] error=${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add routes/email.js
git commit -m "refactor: move send-email routes to routes/email.js"
```

---

### Task 12: Rewrite server.js as clean entry point

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Replace server.js with clean router-mounting entry point**

Replace the entire `server.js` with:
```js
"use strict";

require("dotenv").config();

// Fail fast on missing required env vars before any other imports
const required = ["MONGODB_URI", "JWT_SECRET", "TRACK_SECRET", "DASHBOARD_PASSWORD"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`[server] Missing required env var: ${key}`);
}

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const { connectDB, closeDB, getDB } = require("./db");
const authRouter = require("./routes/auth");
const trackingRouter = require("./routes/tracking");
const statsRouter = require("./routes/stats");
const templatesRouter = require("./routes/templates");
const emailRouter = require("./routes/email");

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(cors({
  origin: [process.env.DASHBOARD_ORIGIN, "http://localhost:5173"].filter(Boolean),
}));
app.use(morgan("combined"));

// Public routes
app.get("/health", async (req, res) => {
  try {
    await getDB().command({ ping: 1 });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.use("/auth", authRouter);
app.use("/", trackingRouter);   // POST /track-event
app.use("/", statsRouter);       // GET /api/bunches, /api/stats, /api/events
app.use("/", templatesRouter);   // /api/templates/*
app.use("/", emailRouter);       // POST /send-email, /send-bulk-emails

// Global error handler
app.use((err, req, res, _next) => {
  console.error("[unhandled]", err);
  return res.status(500).json({ ok: false, error: "Internal server error" });
});

const PORT = process.env.PORT || 3000;

async function start() {
  await connectDB();
  app.listen(PORT, () => console.log(`[server] listening on port ${PORT}`));
}

async function shutdown(signal) {
  console.log(`[server] ${signal} received — shutting down gracefully`);
  await closeDB();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Verify server starts locally**

```bash
cd C:/Users/spsou/Documents/trackmail
node server.js
```

Expected: `[db] connected to MongoDB` then `[server] listening on port 3000`.
If env vars are missing, it will throw immediately with a clear message.

- [ ] **Step 3: Run all tests to verify nothing broke**

```bash
npx jest
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "refactor: rewrite server.js as clean entry point with route modules and graceful shutdown"
```

---

## Phase 4: Cloudflare Worker Update

### Task 13: Write updated Cloudflare Worker

**Files:**
- Create: `cloudflare-worker.js` (reference file — must be manually deployed to Cloudflare)

- [ ] **Step 1: Create the updated worker file**

Create `cloudflare-worker.js`:
```js
/**
 * Trackmail Cloudflare Worker
 *
 * Handles open-pixel and click-redirect tracking.
 * On each event, notifies the Express API to persist to MongoDB.
 *
 * Required environment variables (set in Cloudflare dashboard):
 *   EXPRESS_API_URL  — e.g. https://trackmail-api.onrender.com
 *   TRACK_SECRET     — must match TRACK_SECRET on the Express server
 */

// Minimal 1x1 transparent GIF
const PIXEL_GIF = new Uint8Array([
  0x47,0x49,0x46,0x38,0x39,0x61,0x01,0x00,0x01,0x00,0x80,0x00,0x00,
  0xff,0xff,0xff,0x00,0x00,0x00,0x21,0xf9,0x04,0x00,0x00,0x00,0x00,
  0x00,0x2c,0x00,0x00,0x00,0x00,0x01,0x00,0x01,0x00,0x00,0x02,0x02,
  0x44,0x01,0x00,0x3b,
]);

/**
 * Fire-and-forget notify to Express. Retries once.
 * Failures are silently dropped — tracking loss is acceptable,
 * a broken redirect/pixel is not.
 */
async function notifyAPI(env, payload) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(`${env.EXPRESS_API_URL}/track-event`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-track-secret": env.TRACK_SECRET,
        },
        body: JSON.stringify(payload),
      });
      if (resp.ok) return;
      console.error(`[worker] notifyAPI attempt ${attempt + 1} failed: ${resp.status}`);
    } catch (e) {
      console.error(`[worker] notifyAPI attempt ${attempt + 1} error: ${e.message}`);
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const email = url.searchParams.get("email") || "";
    const bid = url.searchParams.get("bid") || "";

    // ── Open tracking pixel ──────────────────────────────────────────────────
    if (url.pathname === "/track-open") {
      if (email && bid) {
        ctx.waitUntil(notifyAPI(env, { email, event: "open", bunch_id: bid }));
      }
      return new Response(PIXEL_GIF, {
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          "Pragma": "no-cache",
        },
      });
    }

    // ── Click tracking redirect ──────────────────────────────────────────────
    if (url.pathname === "/track-link") {
      const dest = url.searchParams.get("url");
      if (!dest) return new Response("Missing url parameter", { status: 400 });
      if (email && bid) {
        ctx.waitUntil(notifyAPI(env, { email, event: "click", url: dest, bunch_id: bid }));
      }
      return Response.redirect(dest, 302);
    }

    return new Response("Not found", { status: 404 });
  },
};
```

- [ ] **Step 2: Deploy to Cloudflare (manual step)**

1. Go to https://dash.cloudflare.com → Workers & Pages → your worker (`test-open`)
2. Click **Edit code**
3. Replace the entire worker code with the contents of `cloudflare-worker.js`
4. Go to **Settings → Variables** and add:
   - `EXPRESS_API_URL` = your Render URL (e.g. `https://trackmail-api.onrender.com`)
   - `TRACK_SECRET` = same value as `TRACK_SECRET` in your Express `.env`
5. Click **Save and deploy**

- [ ] **Step 3: Verify the worker (once Express is deployed)**

```bash
curl "https://test-open.sppathak1428.workers.dev/track-open?email=test%40test.com&bid=280326"
```

Expected: Response with `Content-Type: image/gif` and your Express logs show `[track-event]` inserted.

- [ ] **Step 4: Commit**

```bash
git add cloudflare-worker.js
git commit -m "feat: add updated Cloudflare Worker with bid param and Express notify (deploy manually)"
```

---

## Phase 5: React Dashboard

### Task 14: Scaffold dashboard Vite + Tailwind app

**Files:**
- Create: `dashboard/package.json`
- Create: `dashboard/vite.config.js`
- Create: `dashboard/tailwind.config.js`
- Create: `dashboard/postcss.config.js`
- Create: `dashboard/index.html`
- Create: `dashboard/vercel.json`

- [ ] **Step 1: Scaffold the Vite React app**

```bash
cd C:/Users/spsou/Documents/trackmail
npm create vite@latest dashboard -- --template react
cd dashboard
npm install
npm install react-router-dom axios recharts
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

- [ ] **Step 2: Configure Tailwind**

Replace `dashboard/tailwind.config.js` with:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#1a56db", dark: "#1e429f" },
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 3: Configure Vite proxy for local dev**

Replace `dashboard/vite.config.js` with:
```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
      "/auth": { target: "http://localhost:3000", changeOrigin: true },
      "/track-event": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
```

- [ ] **Step 4: Create vercel.json for production API proxy**

Create `dashboard/vercel.json`:
```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "VITE_API_URL/api/:path*" },
    { "source": "/auth/:path*", "destination": "VITE_API_URL/auth/:path*" }
  ]
}
```

> Note: Vercel doesn't support dynamic rewrites from env vars in `vercel.json`. Instead, the `VITE_API_URL` env var is baked in at build time. The actual production approach: the React app calls `/api/...` locally (proxied by vite in dev), and in production calls `${import.meta.env.VITE_API_URL}/api/...` directly (no proxy needed). Update `api.js` in Task 15 accordingly.

Replace `dashboard/vercel.json` with:
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite"
}
```

- [ ] **Step 5: Update dashboard/src/index.css to include Tailwind**

Replace `dashboard/src/index.css` with:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 6: Verify dashboard builds**

```bash
cd C:/Users/spsou/Documents/trackmail/dashboard
npm run dev
```

Expected: Vite dev server starts at `http://localhost:5173`, shows default React app.

- [ ] **Step 7: Commit**

```bash
cd ..
git add dashboard/
git commit -m "feat: scaffold React/Vite dashboard with Tailwind and proxy config"
```

---

### Task 15: api.js — Axios instance with auth interceptor

**Files:**
- Create: `dashboard/src/api.js`

- [ ] **Step 1: Create api.js**

Create `dashboard/src/api.js`:
```js
import axios from "axios";

// In dev: Vite proxy handles /api → localhost:3000
// In production: VITE_API_URL is the Render URL
const BASE = import.meta.env.VITE_API_URL || "";

const api = axios.create({ baseURL: BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("trackmail_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("trackmail_token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default api;
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/api.js
git commit -m "feat: add Axios instance with JWT interceptor and 401 redirect"
```

---

### Task 16: App.jsx — routing + protected routes

**Files:**
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/main.jsx`

- [ ] **Step 1: Update main.jsx**

Replace `dashboard/src/main.jsx` with:
```jsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 2: Write App.jsx with routing**

Replace `dashboard/src/App.jsx` with:
```jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Recipients from "./pages/Recipients";
import Templates from "./pages/Templates";
import Navbar from "./components/Navbar";

function PrivateRoute({ children }) {
  const token = localStorage.getItem("trackmail_token");
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

function Layout({ children }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <Layout><Overview /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/recipients"
          element={
            <PrivateRoute>
              <Layout><Recipients /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/templates"
          element={
            <PrivateRoute>
              <Layout><Templates /></Layout>
            </PrivateRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/App.jsx dashboard/src/main.jsx
git commit -m "feat: add React Router with PrivateRoute guard"
```

---

### Task 17: Navbar component

**Files:**
- Create: `dashboard/src/components/Navbar.jsx`

- [ ] **Step 1: Create Navbar.jsx**

```bash
mkdir -p dashboard/src/components
```

Create `dashboard/src/components/Navbar.jsx`:
```jsx
import { NavLink, useNavigate } from "react-router-dom";

export default function Navbar() {
  const navigate = useNavigate();

  function logout() {
    localStorage.removeItem("trackmail_token");
    navigate("/login");
  }

  const linkClass = ({ isActive }) =>
    isActive
      ? "text-white font-semibold border-b-2 border-white pb-1"
      : "text-blue-100 hover:text-white pb-1";

  return (
    <nav className="bg-brand shadow-sm">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="text-white font-bold text-lg tracking-tight">Trackmail</span>
          <NavLink to="/" end className={linkClass}>Overview</NavLink>
          <NavLink to="/recipients" className={linkClass}>Recipients</NavLink>
          <NavLink to="/templates" className={linkClass}>Templates</NavLink>
        </div>
        <button
          onClick={logout}
          className="text-blue-100 hover:text-white text-sm"
        >
          Logout
        </button>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/components/Navbar.jsx
git commit -m "feat: add Navbar component with active link highlighting"
```

---

### Task 18: Login page

**Files:**
- Create: `dashboard/src/pages/Login.jsx`

- [ ] **Step 1: Create Login.jsx**

```bash
mkdir -p dashboard/src/pages
```

Create `dashboard/src/pages/Login.jsx`:
```jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.post("/auth/login", { password });
      localStorage.setItem("trackmail_token", res.data.token);
      navigate("/");
    } catch {
      setError("Incorrect password. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Trackmail</h1>
        <p className="text-gray-500 text-sm mb-6">Email analytics dashboard</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              placeholder="Enter dashboard password"
              required
              autoFocus
            />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand text-white rounded px-4 py-2 text-sm font-medium hover:bg-brand-dark disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/Login.jsx
git commit -m "feat: add Login page"
```

---

### Task 19: StatCard + BunchSelector components

**Files:**
- Create: `dashboard/src/components/StatCard.jsx`
- Create: `dashboard/src/components/BunchSelector.jsx`

- [ ] **Step 1: Create StatCard.jsx**

Create `dashboard/src/components/StatCard.jsx`:
```jsx
export default function StatCard({ label, value, sub, color = "blue" }) {
  const colors = {
    blue: "bg-blue-50 border-blue-200 text-blue-700",
    green: "bg-green-50 border-green-200 text-green-700",
    purple: "bg-purple-50 border-purple-200 text-purple-700",
    orange: "bg-orange-50 border-orange-200 text-orange-700",
  };
  return (
    <div className={`rounded-lg border p-5 ${colors[color]}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs mt-1 opacity-60">{sub}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Create BunchSelector.jsx**

Create `dashboard/src/components/BunchSelector.jsx`:
```jsx
// Formats DDMMYY → "28 Mar 2026"
function formatBunchId(bid) {
  if (!bid || bid.length !== 6) return bid;
  const day = bid.slice(0, 2);
  const month = bid.slice(2, 4);
  const year = "20" + bid.slice(4, 6);
  const date = new Date(`${year}-${month}-${day}`);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function BunchSelector({ bunches, selected, onChange }) {
  return (
    <select
      value={selected}
      onChange={(e) => onChange(e.target.value)}
      className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand"
    >
      {bunches.map((b) => (
        <option key={b.bunch_id} value={b.bunch_id}>
          {formatBunchId(b.bunch_id)} — {b.sent} sent
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/StatCard.jsx dashboard/src/components/BunchSelector.jsx
git commit -m "feat: add StatCard and BunchSelector components"
```

---

### Task 20: EventFeed component

**Files:**
- Create: `dashboard/src/components/EventFeed.jsx`

- [ ] **Step 1: Create EventFeed.jsx**

Create `dashboard/src/components/EventFeed.jsx`:
```jsx
function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const EVENT_STYLES = {
  open: { label: "Opened", badge: "bg-green-100 text-green-700" },
  click: { label: "Clicked", badge: "bg-blue-100 text-blue-700" },
  comeback: { label: "Came Back", badge: "bg-purple-100 text-purple-700" },
};

export default function EventFeed({ events }) {
  if (!events.length) {
    return <p className="text-sm text-gray-400 py-4 text-center">No events yet.</p>;
  }
  return (
    <ul className="divide-y divide-gray-100">
      {events.map((e, i) => {
        const style = EVENT_STYLES[e.event] || { label: e.event, badge: "bg-gray-100 text-gray-600" };
        return (
          <li key={i} className="flex items-center justify-between py-2.5 text-sm">
            <span className="text-gray-700 font-mono truncate max-w-xs">{e.email}</span>
            <div className="flex items-center gap-3 shrink-0">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${style.badge}`}>
                {style.label}
              </span>
              <span className="text-gray-400 text-xs">{timeAgo(e.timestamp)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/components/EventFeed.jsx
git commit -m "feat: add EventFeed component"
```

---

### Task 21: Overview page

**Files:**
- Create: `dashboard/src/pages/Overview.jsx`

- [ ] **Step 1: Create Overview.jsx**

Create `dashboard/src/pages/Overview.jsx`:
```jsx
import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import api from "../api";
import StatCard from "../components/StatCard";
import BunchSelector from "../components/BunchSelector";
import EventFeed from "../components/EventFeed";

export default function Overview() {
  const [bunches, setBunches] = useState([]);
  const [selectedBunch, setSelectedBunch] = useState("");
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Load bunches on mount
  useEffect(() => {
    api.get("/api/bunches")
      .then(res => {
        setBunches(res.data);
        if (res.data.length > 0) setSelectedBunch(res.data[0].bunch_id);
      })
      .catch(() => setError("Failed to load bunches"));
  }, []);

  // Load stats + events when selectedBunch changes
  useEffect(() => {
    if (!selectedBunch) return;
    setLoading(true);
    Promise.all([
      api.get(`/api/stats?bunchId=${selectedBunch}`),
      api.get(`/api/events?bunchId=${selectedBunch}`),
    ])
      .then(([statsRes, eventsRes]) => {
        setStats(statsRes.data);
        // Sort by sentAt desc for activity feed; take last 10 from events that opened/clicked
        const feed = eventsRes.data
          .flatMap(r => {
            const out = [];
            if (r.opened) out.push({ email: r.email, event: "open", timestamp: r.sentAt });
            if (r.clicked) out.push({ email: r.email, event: "click", timestamp: r.sentAt });
            if (r.cameBack) out.push({ email: r.email, event: "comeback", timestamp: r.sentAt });
            return out;
          })
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .slice(0, 10);
        setEvents(feed);
      })
      .catch(() => setError("Failed to load stats"))
      .finally(() => setLoading(false));
  }, [selectedBunch]);

  // Build chart data: one data point per bunch (opens vs clicks)
  const chartData = bunches.map(b => ({
    name: b.bunch_id,
    sent: b.sent,
  }));

  if (error) return <p className="text-red-500">{error}</p>;

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">Overview</h1>
        {bunches.length > 0 && (
          <BunchSelector bunches={bunches} selected={selectedBunch} onChange={setSelectedBunch} />
        )}
      </div>

      {/* Stat cards */}
      {loading || !stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Emails Sent" value={stats.sent} color="blue" />
          <StatCard label="Opened" value={stats.opens} sub={`${stats.openRate}% open rate`} color="green" />
          <StatCard label="Clicked" value={stats.clicks} sub={`${stats.clickRate}% click rate`} color="purple" />
          <StatCard label="Came Back" value={stats.cameBack} sub="clicked more than once" color="orange" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Emails Sent by Batch</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="sent" stroke="#1a56db" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Activity feed */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Recent Activity</h2>
          <EventFeed events={events} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/Overview.jsx
git commit -m "feat: add Overview page with stat cards, chart, and activity feed"
```

---

### Task 22: RecipientTable component + Recipients page

**Files:**
- Create: `dashboard/src/components/RecipientTable.jsx`
- Create: `dashboard/src/pages/Recipients.jsx`

- [ ] **Step 1: Create RecipientTable.jsx**

Create `dashboard/src/components/RecipientTable.jsx`:
```jsx
import { useState } from "react";

const PAGE_SIZE = 50;

function Badge({ active, children }) {
  return active ? (
    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">{children}</span>
  ) : (
    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400">{children}</span>
  );
}

export default function RecipientTable({ rows }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("sentAt");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(0);

  const filtered = rows.filter(r => r.email.toLowerCase().includes(search.toLowerCase()));
  const sorted = [...filtered].sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (sortKey === "sentAt") { av = new Date(av); bv = new Date(bv); }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const paginated = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
    setPage(0);
  }

  function SortHeader({ k, children }) {
    return (
      <th
        className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-800"
        onClick={() => toggleSort(k)}
      >
        {children} {sortKey === k ? (sortDir === "asc" ? "↑" : "↓") : ""}
      </th>
    );
  }

  return (
    <div className="space-y-3">
      <input
        type="text"
        placeholder="Search by email..."
        value={search}
        onChange={e => { setSearch(e.target.value); setPage(0); }}
        className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full max-w-sm focus:outline-none focus:ring-2 focus:ring-brand"
      />

      <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100">
            <tr>
              <SortHeader k="email">Email</SortHeader>
              <SortHeader k="sentAt">Sent At</SortHeader>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Opened</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Clicked</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Came Back</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {paginated.length === 0 && (
              <tr><td colSpan={5} className="text-center py-8 text-gray-400">No recipients found.</td></tr>
            )}
            {paginated.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{r.email}</td>
                <td className="px-4 py-2.5 text-gray-500 text-xs">{r.sentAt ? new Date(r.sentAt).toLocaleString() : "—"}</td>
                <td className="px-4 py-2.5"><Badge active={r.opened}>Opened</Badge></td>
                <td className="px-4 py-2.5"><Badge active={r.clicked}>Clicked</Badge></td>
                <td className="px-4 py-2.5"><Badge active={r.cameBack}>Came Back</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1 border rounded disabled:opacity-40">Prev</button>
          <span className="text-gray-500">{page + 1} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-3 py-1 border rounded disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create Recipients.jsx**

Create `dashboard/src/pages/Recipients.jsx`:
```jsx
import { useState, useEffect } from "react";
import api from "../api";
import BunchSelector from "../components/BunchSelector";
import RecipientTable from "../components/RecipientTable";

export default function Recipients() {
  const [bunches, setBunches] = useState([]);
  const [selectedBunch, setSelectedBunch] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/api/bunches")
      .then(res => {
        setBunches(res.data);
        if (res.data.length > 0) setSelectedBunch(res.data[0].bunch_id);
      })
      .catch(() => setError("Failed to load bunches"));
  }, []);

  useEffect(() => {
    if (!selectedBunch) return;
    setLoading(true);
    api.get(`/api/events?bunchId=${selectedBunch}`)
      .then(res => setRows(res.data))
      .catch(() => setError("Failed to load recipients"))
      .finally(() => setLoading(false));
  }, [selectedBunch]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">Recipients</h1>
        {bunches.length > 0 && (
          <BunchSelector bunches={bunches} selected={selectedBunch} onChange={setSelectedBunch} />
        )}
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      {loading ? (
        <div className="h-64 bg-gray-100 rounded-lg animate-pulse" />
      ) : (
        <RecipientTable rows={rows} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/RecipientTable.jsx dashboard/src/pages/Recipients.jsx
git commit -m "feat: add RecipientTable with sort/search/pagination and Recipients page"
```

---

### Task 23: TemplateEditor component + Templates page

**Files:**
- Create: `dashboard/src/components/TemplateEditor.jsx`
- Create: `dashboard/src/pages/Templates.jsx`

- [ ] **Step 1: Create TemplateEditor.jsx**

Create `dashboard/src/components/TemplateEditor.jsx`:
```jsx
import { useState, useEffect } from "react";
import api from "../api";

export default function TemplateEditor({ template, onSaved, onActivated }) {
  const [name, setName] = useState(template?.name || "");
  const [html, setHtml] = useState(template?.html || "");
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [msg, setMsg] = useState("");

  // Sync when a different template is selected
  useEffect(() => {
    setName(template?.name || "");
    setHtml(template?.html || "");
    setMsg("");
  }, [template?._id]);

  async function handleSave() {
    if (!name.trim() || !html.trim()) { setMsg("Name and HTML are required."); return; }
    setSaving(true);
    setMsg("");
    try {
      if (template?._id) {
        await api.put(`/api/templates/${template._id}`, { name, html });
        setMsg("Saved.");
      } else {
        await api.post("/api/templates", { name, html });
        setMsg("Template created.");
      }
      onSaved?.();
    } catch {
      setMsg("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate() {
    if (!template?._id) return;
    setActivating(true);
    try {
      await api.post(`/api/templates/${template._id}/activate`);
      setMsg("Set as active.");
      onActivated?.();
    } catch {
      setMsg("Activation failed.");
    } finally {
      setActivating(false);
    }
  }

  return (
    <div className="flex flex-col h-full gap-3">
      <input
        type="text"
        placeholder="Template name"
        value={name}
        onChange={e => setName(e.target.value)}
        className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
      />

      <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
        {/* Editor */}
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">HTML</p>
          <textarea
            value={html}
            onChange={e => setHtml(e.target.value)}
            className="flex-1 font-mono text-xs border border-gray-300 rounded p-2 resize-none focus:outline-none focus:ring-2 focus:ring-brand"
            style={{ minHeight: "420px" }}
            spellCheck={false}
          />
        </div>

        {/* Preview */}
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Preview</p>
          <iframe
            srcDoc={html || "<p style='color:#aaa;padding:16px;'>Preview will appear here.</p>"}
            className="flex-1 border border-gray-200 rounded bg-gray-50"
            title="Email Preview"
            style={{ minHeight: "420px" }}
            sandbox="allow-same-origin"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-brand text-white rounded text-sm font-medium hover:bg-brand-dark disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {template?._id && (
          <button
            onClick={handleActivate}
            disabled={activating}
            className="px-4 py-2 border border-green-600 text-green-700 rounded text-sm font-medium hover:bg-green-50 disabled:opacity-60"
          >
            {activating ? "Activating..." : "Set as Active"}
          </button>
        )}
        {msg && <span className="text-sm text-gray-500">{msg}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create Templates.jsx**

Create `dashboard/src/pages/Templates.jsx`:
```jsx
import { useState, useEffect, useCallback } from "react";
import api from "../api";
import TemplateEditor from "../components/TemplateEditor";

export default function Templates() {
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState(null); // { _id, name, html }
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState("");

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/templates");
      setTemplates(res.data);
    } catch {
      setError("Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  async function selectTemplate(tmpl) {
    // Fetch full HTML on select
    try {
      const res = await api.get(`/api/templates/${tmpl._id}`);
      setSelected(res.data);
    } catch {
      setError("Failed to load template");
    }
  }

  async function loadDefault() {
    try {
      const res = await api.get("/api/templates/active");
      setSelected({ _id: null, name: res.data.name, html: res.data.html });
    } catch {
      setError("Failed to load default template");
    }
  }

  async function handleDelete(tmpl) {
    if (!window.confirm(`Delete "${tmpl.name}"?`)) return;
    setDeleting(tmpl._id);
    try {
      await api.delete(`/api/templates/${tmpl._id}`);
      await loadTemplates();
      if (selected?._id === tmpl._id) setSelected(null);
    } catch (e) {
      setError(e.response?.data?.error || "Delete failed");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-gray-800">Email Templates</h1>
      {error && <p className="text-red-500 text-sm">{error}</p>}

      <div className="grid grid-cols-12 gap-6">
        {/* Left panel: template list */}
        <div className="col-span-3 space-y-2">
          <button
            onClick={() => setSelected({ _id: null, name: "", html: "" })}
            className="w-full text-left px-3 py-2 text-sm border border-dashed border-gray-300 rounded hover:bg-gray-50 text-gray-500"
          >
            + New template
          </button>

          <button
            onClick={loadDefault}
            className="w-full text-left px-3 py-2 text-sm border border-dashed border-blue-200 rounded hover:bg-blue-50 text-blue-500"
          >
            Load default (test.html)
          </button>

          {loading && <p className="text-xs text-gray-400 py-2">Loading...</p>}

          {templates.map(t => (
            <div
              key={t._id}
              onClick={() => selectTemplate(t)}
              className={`flex items-center justify-between px-3 py-2 rounded cursor-pointer text-sm border ${
                selected?._id === t._id
                  ? "bg-blue-50 border-blue-200"
                  : "bg-white border-gray-100 hover:bg-gray-50"
              }`}
            >
              <div className="truncate">
                <p className="font-medium text-gray-800 truncate">{t.name}</p>
                {t.isActive && (
                  <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">Active</span>
                )}
              </div>
              {!t.isActive && (
                <button
                  onClick={e => { e.stopPropagation(); handleDelete(t); }}
                  disabled={deleting === t._id}
                  className="ml-2 text-gray-300 hover:text-red-400 text-lg leading-none shrink-0"
                  title="Delete"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Right panel: editor */}
        <div className="col-span-9">
          {selected !== null ? (
            <TemplateEditor
              template={selected}
              onSaved={() => { loadTemplates(); }}
              onActivated={() => { loadTemplates(); }}
            />
          ) : (
            <div className="h-64 flex items-center justify-center text-gray-400 text-sm border border-dashed border-gray-200 rounded-lg">
              Select a template from the left, or create a new one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/TemplateEditor.jsx dashboard/src/pages/Templates.jsx
git commit -m "feat: add TemplateEditor with live preview and Templates page"
```

---

### Task 24: Dashboard end-to-end smoke test

**Files:** None created

- [ ] **Step 1: Start Express and dashboard dev server**

Terminal 1:
```bash
cd C:/Users/spsou/Documents/trackmail
node server.js
```

Terminal 2:
```bash
cd C:/Users/spsou/Documents/trackmail/dashboard
npm run dev
```

- [ ] **Step 2: Run through every feature manually**

1. Open `http://localhost:5173/login`
2. Enter wrong password → should show "Incorrect password"
3. Enter correct password → should redirect to `/`
4. Overview: stat cards load, bunch selector works, chart renders
5. Recipients: table loads, search filters, pagination works
6. Templates: list loads, clicking "Load default (test.html)" shows the current email HTML in the editor, live preview renders
7. Create a new template → should appear in the list
8. Set it as active → green "Active" badge appears
9. Logout → redirected to `/login`

- [ ] **Step 3: Verify track-event endpoint manually**

```bash
curl -X POST http://localhost:3000/track-event \
  -H "Content-Type: application/json" \
  -H "x-track-secret: YOUR_TRACK_SECRET" \
  -d '{"email":"test@example.com","event":"open","bunch_id":"280326"}'
```

Expected: `{"ok":true}`

- [ ] **Step 4: Run all backend tests one final time**

```bash
cd C:/Users/spsou/Documents/trackmail
npx jest
```

Expected: All tests pass.

---

## Phase 6: Deployment

### Task 25: Update .env.example + add render.yaml

**Files:**
- Modify: `.env.example` (or create if missing)
- Create: `render.yaml`

- [ ] **Step 1: Update .env.example**

Create/replace `.env.example`:
```
# MongoDB
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority

# Gmail SMTP
EMAIL_USER=you@gmail.com
EMAIL_PASS=your-gmail-app-password

# LinkedIn scraper
LINKEDIN_EMAIL=your-linkedin@email.com
LINKEDIN_PASSWORD=your-linkedin-password

# Dashboard auth
DASHBOARD_PASSWORD=choose-a-strong-password
JWT_SECRET=generate-with-openssl-rand-base64-32
TRACK_SECRET=generate-with-openssl-rand-base64-32

# CORS: set to your Vercel dashboard URL
DASHBOARD_ORIGIN=https://trackmail-dashboard.vercel.app

# Optional
PORT=3000
```

- [ ] **Step 2: Create render.yaml**

Create `render.yaml`:
```yaml
services:
  - type: web
    name: trackmail-api
    runtime: node
    buildCommand: npm ci --omit=dev
    startCommand: node server.js
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: MONGODB_URI
        sync: false
      - key: EMAIL_USER
        sync: false
      - key: EMAIL_PASS
        sync: false
      - key: DASHBOARD_PASSWORD
        sync: false
      - key: JWT_SECRET
        sync: false
      - key: TRACK_SECRET
        sync: false
      - key: DASHBOARD_ORIGIN
        sync: false
```

- [ ] **Step 3: Commit**

```bash
git add .env.example render.yaml
git commit -m "chore: add render.yaml and update .env.example with all required vars"
```

---

### Task 26: Deploy to Render + Vercel

**Files:** None — deployment steps

- [ ] **Step 1: Deploy Express API to Render**

1. Push the branch to GitHub: `git push origin main`
2. Go to https://render.com → New → Web Service
3. Connect your GitHub repo `trackmail`
4. Settings:
   - Build command: `npm ci --omit=dev`
   - Start command: `node server.js`
   - Node version: 20
5. Add environment variables (from `.env.example`) under Environment tab
6. Click **Create Web Service**
7. Wait for deployment. Visit `https://<your-app>.onrender.com/health`

Expected: `{"ok":true}`

- [ ] **Step 2: Deploy React dashboard to Vercel**

1. Go to https://vercel.com → New Project
2. Import GitHub repo, set **Root Directory** to `dashboard`
3. Framework preset: Vite
4. Add environment variable: `VITE_API_URL` = your Render URL (e.g. `https://trackmail-api.onrender.com`)
5. Click **Deploy**
6. Visit the Vercel URL → login page should appear

- [ ] **Step 3: Update DASHBOARD_ORIGIN on Render**

1. In Render dashboard → Environment → update `DASHBOARD_ORIGIN` to your Vercel URL
2. Trigger a redeploy

- [ ] **Step 4: Update Cloudflare Worker**

1. In Cloudflare dashboard → update `EXPRESS_API_URL` to your Render URL
2. Save and deploy

- [ ] **Step 5: Full production smoke test**

1. Visit Vercel URL → login → verify dashboard loads
2. Trigger a `DRY_RUN=true` send manually from GitHub Actions
3. Visit an email link in a test email (to yourself) — verify tracking event appears in Recipients tab

---

## Self-Review Checklist

### Spec coverage
- [x] §2.1 send-daily-emails.js fixes → Task 3
- [x] §2.2 server.js fixes → Tasks 5, 6, 12
- [x] §2.3 mailer.js verify → Task 2
- [x] §2.4 scraper shared client → Task 4
- [x] §2.5 login_page screenshots → Task 4
- [x] §2.6 .gitignore → Task 1
- [x] §2.7 package.json deps → Task 1
- [x] §3 TrackingEvents + EmailTemplates → db.js (Task 5) + routes (Tasks 8, 10)
- [x] §4 all API endpoints → Tasks 7-11
- [x] §5 Cloudflare Worker → Task 13
- [x] §6 React dashboard all pages → Tasks 14-23
- [x] §7 Render + Vercel deployment → Tasks 25-26
- [x] "came back" definition (>1 click) → routes/stats.js + RecipientTable

### Type consistency
- `bunch_id` (snake_case) used consistently across MongoDB docs, API params, and frontend query strings
- `bunchId` (camelCase) used for HTTP query params (`?bunchId=X`) — consistent across all routes and frontend calls
- `_id` from MongoDB ObjectId — always stringified by JSON serialization, used as-is in frontend
- `verifyJWT` / `verifyTrackSecret` middleware names match imports in all route files
- `connectDB` / `getDB` / `closeDB` exports from `db.js` match all import sites
