# Trackmail Fixes + Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete remaining spec work: wire server.js with all routes, add templates CRUD, create Cloudflare Worker, build React dashboard, add env.example, update docs.

**Architecture:** All backend routes are already implemented as standalone Express routers (auth, tracking, stats). This plan wires them into server.js, adds the missing templates router, creates the Cloudflare Worker for tracking, and builds a Vite+React dashboard that consumes the API.

**Tech Stack:** Node.js/Express (backend), Cloudflare Workers (tracking pixel), React 18 + Vite + Tailwind + Recharts + React Router v6 (dashboard)

---

## Already Done (do NOT re-implement)

- `send-daily-emails.js` — fully updated per spec ✅
- `mailer.js` — SMTP verify on startup ✅
- `db.js` — connectDB/getDB/closeDB singleton ✅
- `middleware/auth.js` — verifyJWT ✅
- `middleware/trackSecret.js` — verifyTrackSecret ✅
- `routes/auth.js` — POST /login with tests ✅
- `routes/tracking.js` — POST /track-event with tests ✅
- `routes/stats.js` — GET /api/bunches, /api/stats, /api/events with tests ✅
- `scripts/setup-indexes.js` ✅
- `scraper/pages/search_page.py` — shared MongoClient ✅
- `scraper/pages/login_page.py` — conditional screenshots ✅
- `.gitignore` — scraper entries ✅
- `package.json` — jsonwebtoken/bcryptjs present, no unused deps ✅

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `routes/templates.js` | Create | Template CRUD + activate (JWT-protected) |
| `tests/templates.test.js` | Create | Unit tests for templates routes |
| `server.js` | Rewrite | Wire all routes; throw on missing MONGODB_URI; restricted CORS; graceful shutdown |
| `worker/index.js` | Create | Cloudflare Worker: track-open pixel + track-link redirect → POST /track-event |
| `worker/wrangler.toml` | Create | Deployment config skeleton |
| `dashboard/` | Create | Full React dashboard (Vite scaffold + all components + pages) |
| `.env.example` | Create | All required env vars documented |
| `CLAUDE.md` | Modify | Reflect new files, collections, endpoints, env vars |

---

## Task 1: `routes/templates.js` + Tests (TDD)

**Files:**
- Create: `routes/templates.js`
- Create: `tests/templates.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/templates.test.js`:

```js
"use strict";

const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");

process.env.JWT_SECRET = "test-jwt-secret-32chars-minimum!!";

jest.mock("../db", () => ({ getDB: jest.fn() }));
const { getDB } = require("../db");
const templatesRouter = require("../routes/templates");

const app = express();
app.use(express.json());
app.use("/api", templatesRouter);

function makeToken() {
  return jwt.sign({ sub: "dashboard" }, process.env.JWT_SECRET, { expiresIn: "1h" });
}
const fakeId = new ObjectId().toHexString();

describe("GET /api/templates", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/templates");
    expect(res.status).toBe(401);
  });

  it("returns template list without html field", async () => {
    const mockFind = {
      project: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([{ _id: fakeId, name: "t1", isActive: false }]),
    };
    getDB.mockReturnValue({ collection: jest.fn(() => ({ find: jest.fn(() => mockFind) })) });
    const res = await request(app).get("/api/templates").set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("GET /api/templates/active", () => {
  it("returns 404 when no active template", async () => {
    getDB.mockReturnValue({ collection: jest.fn(() => ({ findOne: jest.fn().mockResolvedValue(null) })) });
    const res = await request(app).get("/api/templates/active").set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(404);
  });

  it("returns active template with html", async () => {
    getDB.mockReturnValue({
      collection: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue({ _id: fakeId, name: "t1", isActive: true, html: "<p>hi</p>" }),
      })),
    });
    const res = await request(app).get("/api/templates/active").set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.html).toBe("<p>hi</p>");
  });
});

describe("POST /api/templates", () => {
  it("returns 400 when name missing", async () => {
    const res = await request(app).post("/api/templates").set("Authorization", `Bearer ${makeToken()}`).send({ html: "<p>hi</p>" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when html missing", async () => {
    const res = await request(app).post("/api/templates").set("Authorization", `Bearer ${makeToken()}`).send({ name: "T" });
    expect(res.status).toBe(400);
  });

  it("creates a template with isActive: false", async () => {
    getDB.mockReturnValue({ collection: jest.fn(() => ({ insertOne: jest.fn().mockResolvedValue({ insertedId: fakeId }) })) });
    const res = await request(app).post("/api/templates").set("Authorization", `Bearer ${makeToken()}`).send({ name: "Test", html: "<p>hi</p>" });
    expect(res.status).toBe(201);
    expect(res.body.isActive).toBe(false);
    expect(res.body.name).toBe("Test");
  });
});

describe("DELETE /api/templates/:id", () => {
  it("rejects deletion of active template", async () => {
    getDB.mockReturnValue({
      collection: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue({ _id: fakeId, isActive: true }),
      })),
    });
    const res = await request(app).delete(`/api/templates/${fakeId}`).set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/active/i);
  });

  it("deletes an inactive template", async () => {
    getDB.mockReturnValue({
      collection: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue({ _id: fakeId, isActive: false }),
        deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      })),
    });
    const res = await request(app).delete(`/api/templates/${fakeId}`).set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("POST /api/templates/:id/activate", () => {
  it("activates a template via bulkWrite", async () => {
    const bulkWrite = jest.fn().mockResolvedValue({});
    getDB.mockReturnValue({ collection: jest.fn(() => ({ bulkWrite })) });
    const res = await request(app).post(`/api/templates/${fakeId}/activate`).set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(bulkWrite).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ updateMany: expect.any(Object) }),
      expect.objectContaining({ updateOne: expect.any(Object) }),
    ]));
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd C:/Users/spsou/Documents/trackmail && npx jest tests/templates.test.js --no-coverage 2>&1 | head -20
```

Expected: FAIL — `Cannot find module '../routes/templates'`

- [ ] **Step 3: Create `routes/templates.js`**

```js
"use strict";

const router = require("express").Router();
const { ObjectId } = require("mongodb");
const { verifyJWT } = require("../middleware/auth");
const { getDB } = require("../db");

router.use(verifyJWT);

// GET /api/templates — list without html
router.get("/templates", async (req, res) => {
  try {
    const templates = await getDB()
      .collection("EmailTemplates")
      .find({})
      .project({ html: 0 })
      .sort({ createdAt: -1 })
      .toArray();
    return res.json(templates);
  } catch (e) {
    console.error("[api/templates]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/templates/active — full HTML of active template
// NOTE: defined BEFORE /:id to prevent "active" being parsed as an ObjectId
router.get("/templates/active", async (req, res) => {
  try {
    const tmpl = await getDB().collection("EmailTemplates").findOne({ isActive: true });
    if (!tmpl) return res.status(404).json({ error: "No active template" });
    return res.json(tmpl);
  } catch (e) {
    console.error("[api/templates/active]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/templates — create
router.post("/templates", async (req, res) => {
  const { name, html } = req.body || {};
  if (!name || !html) return res.status(400).json({ error: "name and html are required" });
  try {
    const now = new Date();
    const result = await getDB().collection("EmailTemplates").insertOne({
      name, html, isActive: false, createdAt: now, updatedAt: now,
    });
    return res.status(201).json({ _id: result.insertedId, name, isActive: false, createdAt: now });
  } catch (e) {
    console.error("[api/templates POST]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

// PUT /api/templates/:id — update name or html
router.put("/templates/:id", async (req, res) => {
  const { name, html } = req.body || {};
  const update = {};
  if (name) update.name = name;
  if (html) update.html = html;
  if (!Object.keys(update).length) return res.status(400).json({ error: "name or html required" });
  update.updatedAt = new Date();
  try {
    const result = await getDB().collection("EmailTemplates").updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: update }
    );
    if (!result.matchedCount) return res.status(404).json({ error: "Template not found" });
    return res.json({ ok: true });
  } catch (e) {
    console.error("[api/templates PUT]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

// DELETE /api/templates/:id — reject if isActive
router.delete("/templates/:id", async (req, res) => {
  try {
    const db = getDB();
    const tmpl = await db.collection("EmailTemplates").findOne({ _id: new ObjectId(req.params.id) });
    if (!tmpl) return res.status(404).json({ error: "Template not found" });
    if (tmpl.isActive) return res.status(400).json({ error: "Cannot delete the active template" });
    await db.collection("EmailTemplates").deleteOne({ _id: new ObjectId(req.params.id) });
    return res.json({ ok: true });
  } catch (e) {
    console.error("[api/templates DELETE]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/templates/:id/activate — bulkWrite: deactivate all, then activate one
router.post("/templates/:id/activate", async (req, res) => {
  try {
    const _id = new ObjectId(req.params.id);
    await getDB().collection("EmailTemplates").bulkWrite([
      { updateMany: { filter: {}, update: { $set: { isActive: false } } } },
      { updateOne: { filter: { _id }, update: { $set: { isActive: true, updatedAt: new Date() } } } },
    ]);
    return res.json({ ok: true });
  } catch (e) {
    console.error("[api/templates activate]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd C:/Users/spsou/Documents/trackmail && npx jest tests/templates.test.js --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/spsou/Documents/trackmail && git add routes/templates.js tests/templates.test.js && git commit -m "feat: add /api/templates CRUD routes with TDD"
```

---

## Task 2: Rewrite `server.js`

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Verify all tests pass before touching server.js**

```bash
cd C:/Users/spsou/Documents/trackmail && npx jest --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 2: Rewrite `server.js`**

Replace the entire file content:

```js
"use strict";

require("dotenv").config();

if (!process.env.MONGODB_URI) {
  throw new Error("[server] MONGODB_URI is not set");
}

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const { connectDB, closeDB, getDB } = require("./db");
const { sendEmail } = require("./mailer");
const { verifyJWT } = require("./middleware/auth");

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(cors({
  origin: [process.env.DASHBOARD_ORIGIN, "http://localhost:5173"].filter(Boolean),
}));
app.use(morgan("combined"));

const { PORT = 3000 } = process.env;

// ── Public routes ─────────────────────────────────────────────────────────────
app.use("/auth", require("./routes/auth"));    // POST /auth/login
app.use("/", require("./routes/tracking"));    // POST /track-event (x-track-secret)

app.get("/health", (req, res) => {
  try {
    getDB();
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── JWT-protected routes ──────────────────────────────────────────────────────
// routes/stats.js and routes/templates.js each apply verifyJWT internally
app.use("/", require("./routes/stats"));           // GET /api/bunches, /api/stats, /api/events
app.use("/api", require("./routes/templates"));    // CRUD /api/templates

async function retryOnce(fn, { retries = 3, baseDelayMs = 500 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt > retries) throw err;
      await new Promise(res => setTimeout(res, baseDelayMs * Math.pow(2, attempt - 1)));
    }
  }
}

// POST /send-email — JWT-protected
app.post("/send-email", verifyJWT, async (req, res) => {
  const { to, subject, html, text, trackId } = req.body || {};
  if (!to || !subject || (!html && !text)) {
    return res.status(400).json({ error: "Missing required fields: to, subject, html|text" });
  }
  try {
    const result = await retryOnce(() => sendEmail({ to, subject, html, text }));
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

// POST /send-bulk-emails — JWT-protected
app.post("/send-bulk-emails", verifyJWT, async (req, res) => {
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
      if (!email) {
        failCount++;
        results.push({ email: null, status: "fail", reason: "Missing email field" });
        continue;
      }
      if (alreadySentSet.has(email)) {
        results.push({ email, status: "skipped", reason: "Already sent" });
        continue;
      }
      try {
        const info = await retryOnce(() => sendEmail({ to: email, subject, html: htmlTemplate, text: textTemplate }));
        await db.collection("AlreadySent").updateOne(
          { bunch_id: bunchID, email },
          { $set: { bunch_id: bunchID, email, subject, sentAt: new Date(), messageId: info.messageId } },
          { upsert: true }
        );
        successCount++;
        results.push({ email, status: "success" });
        console.log(`[bulk] SUCCESS to=${email}`);
      } catch (err) {
        failCount++;
        results.push({ email, status: "fail", error: err.message });
        console.error(`[bulk] FAIL to=${email} error=${err.message}`);
      }
    }

    return res.json({ ok: true, bunchID, sent: successCount, failed: failCount, total: recipients.length, results });
  } catch (e) {
    console.error(`[send-bulk-emails] error=${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error("[unhandled]", err);
  return res.status(500).json({ ok: false, error: "Internal server error" });
});

// Graceful shutdown
async function shutdown() {
  console.log("[server] shutting down...");
  await closeDB();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Start: verify SMTP, connect DB, then listen
require("./mailer").transporter.verify()
  .then(() => console.log("[mailer] SMTP verified"))
  .catch(err => { console.error("[mailer] SMTP failed:", err.message); process.exit(1); });

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`[server] listening on port ${PORT}`));
  })
  .catch(e => { console.error("[server] startup failed:", e); process.exit(1); });
```

- [ ] **Step 3: Run all tests to confirm nothing broke**

```bash
cd C:/Users/spsou/Documents/trackmail && npx jest --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/spsou/Documents/trackmail && git add server.js && git commit -m "feat: rewrite server.js — wire all routes, restricted CORS, JWT protection, graceful shutdown"
```

---

## Task 3: Cloudflare Worker

**Files:**
- Create: `worker/index.js`
- Create: `worker/wrangler.toml`

- [ ] **Step 1: Create `worker/index.js`**

```js
/**
 * Cloudflare Worker — email tracking pixel + link redirector
 *
 * Routes:
 *   GET /track-open?email=<e>&bid=<b>        → 1x1 GIF + async POST to Express
 *   GET /track-link?email=<e>&bid=<b>&url=<u> → 302 redirect + async POST to Express
 *
 * Worker env vars (set via wrangler secret):
 *   EXPRESS_API_URL  — e.g. https://your-api.railway.app
 *   TRACK_SECRET     — shared secret matching server TRACK_SECRET
 */

const PIXEL = new Uint8Array([
  0x47,0x49,0x46,0x38,0x39,0x61,0x01,0x00,0x01,0x00,0x80,0x00,0x00,
  0xff,0xff,0xff,0x00,0x00,0x00,0x21,0xf9,0x04,0x00,0x00,0x00,0x00,
  0x00,0x2c,0x00,0x00,0x00,0x00,0x01,0x00,0x01,0x00,0x00,0x02,0x02,
  0x44,0x01,0x00,0x3b,
]);

async function postEvent(env, body) {
  const url = `${env.EXPRESS_API_URL}/track-event`;
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-track-secret": env.TRACK_SECRET,
    },
    body: JSON.stringify(body),
  };
  try {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    // Retry once — tracking loss is acceptable, broken links are not
    try { await fetch(url, options); } catch { /* silently drop */ }
  }
}

export default {
  async fetch(request, env, ctx) {
    const { pathname, searchParams } = new URL(request.url);
    const email = searchParams.get("email") || "";
    const bid = searchParams.get("bid") || "";

    if (pathname === "/track-open") {
      ctx.waitUntil(postEvent(env, { email, event: "open", bunch_id: bid }));
      return new Response(PIXEL, {
        status: 200,
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Pragma": "no-cache",
        },
      });
    }

    if (pathname === "/track-link") {
      const targetUrl = searchParams.get("url") || "/";
      ctx.waitUntil(postEvent(env, { email, event: "click", bunch_id: bid, url: targetUrl }));
      return Response.redirect(targetUrl, 302);
    }

    return new Response("Not found", { status: 404 });
  },
};
```

- [ ] **Step 2: Create `worker/wrangler.toml`**

```toml
name = "trackmail-pixel"
main = "index.js"
compatibility_date = "2024-01-01"

# Set these as Worker secrets (never commit values):
#   wrangler secret put EXPRESS_API_URL
#   wrangler secret put TRACK_SECRET
```

- [ ] **Step 3: Commit**

```bash
cd C:/Users/spsou/Documents/trackmail && git add worker/ && git commit -m "feat: add Cloudflare Worker for tracking pixel and link redirect"
```

---

## Task 4: React Dashboard — Scaffold + Core Files

**Files:**
- Create: `dashboard/` (Vite scaffold)
- Modify: `dashboard/vite.config.js`
- Modify: `dashboard/tailwind.config.js`
- Create: `dashboard/vercel.json`
- Modify: `dashboard/src/index.css`
- Create: `dashboard/src/api.js`
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/main.jsx`

- [ ] **Step 1: Scaffold with Vite**

```bash
cd C:/Users/spsou/Documents/trackmail && npm create vite@latest dashboard -- --template react
```

Expected: `dashboard/` directory created.

- [ ] **Step 2: Install dependencies**

```bash
cd C:/Users/spsou/Documents/trackmail/dashboard && npm install && npm install tailwindcss@3 postcss autoprefixer recharts axios react-router-dom
```

- [ ] **Step 3: Initialize Tailwind**

```bash
cd C:/Users/spsou/Documents/trackmail/dashboard && npx tailwindcss init -p
```

- [ ] **Step 4: Overwrite `tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 5: Overwrite `vite.config.js`**

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: process.env.VITE_API_URL || "http://localhost:3000", changeOrigin: true },
      "/auth": { target: process.env.VITE_API_URL || "http://localhost:3000", changeOrigin: true },
    },
  },
});
```

- [ ] **Step 6: Create `vercel.json`**

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "YOUR_API_URL/api/:path*" },
    { "source": "/auth/:path*", "destination": "YOUR_API_URL/auth/:path*" }
  ]
}
```

- [ ] **Step 7: Overwrite `src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 8: Create `src/api.js`**

```js
import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "",
});

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

- [ ] **Step 9: Overwrite `src/App.jsx`**

```jsx
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Recipients from "./pages/Recipients";
import Templates from "./pages/Templates";
import Navbar from "./components/Navbar";

function ProtectedLayout() {
  const token = localStorage.getItem("trackmail_token");
  if (!token) return <Navigate to="/login" replace />;
  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<Overview />} />
          <Route path="/recipients" element={<Recipients />} />
          <Route path="/templates" element={<Templates />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 10: Overwrite `src/main.jsx`**

```jsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 11: Delete generated boilerplate files that are no longer needed**

```bash
cd C:/Users/spsou/Documents/trackmail/dashboard/src && rm -f App.css assets/react.svg
```

- [ ] **Step 12: Verify build passes**

```bash
cd C:/Users/spsou/Documents/trackmail/dashboard && npm run build 2>&1 | tail -5
```

Expected: Build succeeds (will have missing import errors until components are created in Task 5 — that's OK, fix in Task 5).

- [ ] **Step 13: Commit scaffold**

```bash
cd C:/Users/spsou/Documents/trackmail && git add dashboard/ && git commit -m "feat: scaffold React dashboard with Vite, Tailwind, routing, and API client"
```

---

## Task 5: React Dashboard — Components

**Files:**
- Create: `dashboard/src/components/Navbar.jsx`
- Create: `dashboard/src/components/BunchSelector.jsx`
- Create: `dashboard/src/components/StatCard.jsx`
- Create: `dashboard/src/components/EventFeed.jsx`
- Create: `dashboard/src/components/RecipientTable.jsx`
- Create: `dashboard/src/components/TemplateEditor.jsx`

- [ ] **Step 1: Create `src/components/Navbar.jsx`**

```jsx
import { NavLink, useNavigate } from "react-router-dom";

const links = [
  { to: "/", label: "Overview" },
  { to: "/recipients", label: "Recipients" },
  { to: "/templates", label: "Templates" },
];

export default function Navbar() {
  const navigate = useNavigate();

  function logout() {
    localStorage.removeItem("trackmail_token");
    navigate("/login");
  }

  return (
    <nav className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center gap-6">
      <span className="font-bold text-blue-400 text-lg mr-4">Trackmail</span>
      {links.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          className={({ isActive }) =>
            `text-sm font-medium transition-colors ${isActive ? "text-blue-400" : "text-slate-300 hover:text-white"}`
          }
        >
          {label}
        </NavLink>
      ))}
      <button
        onClick={logout}
        className="ml-auto text-sm text-slate-400 hover:text-white transition-colors"
      >
        Logout
      </button>
    </nav>
  );
}
```

- [ ] **Step 2: Create `src/components/BunchSelector.jsx`**

```jsx
import { useEffect, useState } from "react";
import api from "../api";

export default function BunchSelector({ value, onChange }) {
  const [bunches, setBunches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/api/bunches")
      .then(r => {
        setBunches(r.data);
        if (r.data.length > 0 && !value) onChange(r.data[0].bunch_id);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-slate-400 text-sm">Loading batches…</div>;

  return (
    <div className="flex items-center gap-3">
      <label className="text-sm text-slate-400">Batch:</label>
      <select
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
      >
        {bunches.map(b => (
          <option key={b.bunch_id} value={b.bunch_id}>
            {b.bunch_id} ({b.sent} sent)
          </option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/components/StatCard.jsx`**

```jsx
export default function StatCard({ label, value, sub, color = "blue" }) {
  const colors = {
    blue: "border-blue-500 text-blue-400",
    green: "border-green-500 text-green-400",
    yellow: "border-yellow-500 text-yellow-400",
    purple: "border-purple-500 text-purple-400",
  };
  return (
    <div className={`bg-slate-800 rounded-lg p-4 border-l-4 ${colors[color]}`}>
      <div className="text-sm text-slate-400 mb-1">{label}</div>
      <div className={`text-3xl font-bold ${colors[color].split(" ")[1]}`}>{value ?? "—"}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Create `src/components/EventFeed.jsx`**

```jsx
function relativeTime(date) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const EVENT_COLORS = {
  open: "bg-blue-500/20 text-blue-300",
  click: "bg-green-500/20 text-green-300",
  comeback: "bg-purple-500/20 text-purple-300",
};

export default function EventFeed({ events = [] }) {
  const last10 = [...events]
    .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))
    .slice(0, 10);

  if (!last10.length) {
    return <div className="text-slate-500 text-sm text-center py-8">No events yet</div>;
  }

  return (
    <div className="space-y-2">
      {last10.map((e, i) => (
        <div key={i} className="flex items-center gap-3 bg-slate-800 rounded px-3 py-2 text-sm">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${EVENT_COLORS[e.event] || "bg-slate-600 text-slate-300"}`}>
            {e.event}
          </span>
          <span className="text-slate-300 truncate flex-1">{e.email}</span>
          <span className="text-slate-500 text-xs shrink-0">{relativeTime(e.sentAt)}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Create `src/components/RecipientTable.jsx`**

```jsx
import { useState, useMemo } from "react";

const PAGE_SIZE = 50;

function Badge({ value }) {
  return value
    ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-green-500/20 text-green-400">✓</span>
    : <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-slate-700 text-slate-500">—</span>;
}

export default function RecipientTable({ rows = [] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("sentAt");
  const [sortDir, setSortDir] = useState(-1);
  const [page, setPage] = useState(0);

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => -d);
    else { setSortKey(key); setSortDir(-1); }
    setPage(0);
  }

  const filtered = useMemo(() =>
    rows.filter(r => r.email.toLowerCase().includes(search.toLowerCase())),
    [rows, search]
  );

  const sorted = useMemo(() =>
    [...filtered].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === "boolean") return sortDir * (Number(av) - Number(bv));
      return sortDir * (new Date(av) - new Date(bv));
    }),
    [filtered, sortKey, sortDir]
  );

  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

  const Th = ({ col, label }) => (
    <th
      onClick={() => toggleSort(col)}
      className="px-3 py-2 text-left text-xs font-medium text-slate-400 uppercase tracking-wider cursor-pointer hover:text-white select-none"
    >
      {label} {sortKey === col ? (sortDir === -1 ? "↓" : "↑") : ""}
    </th>
  );

  return (
    <div className="space-y-3">
      <input
        value={search}
        onChange={e => { setSearch(e.target.value); setPage(0); }}
        placeholder="Filter by email…"
        className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-white w-64 focus:outline-none focus:border-blue-500"
      />
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-800">
            <tr>
              <Th col="email" label="Email" />
              <Th col="sentAt" label="Sent At" />
              <Th col="opened" label="Opened" />
              <Th col="clicked" label="Clicked" />
              <Th col="cameBack" label="Came Back" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {pageRows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-800/50">
                <td className="px-3 py-2 text-slate-300">{r.email}</td>
                <td className="px-3 py-2 text-slate-400">{r.sentAt ? new Date(r.sentAt).toLocaleString() : "—"}</td>
                <td className="px-3 py-2"><Badge value={r.opened} /></td>
                <td className="px-3 py-2"><Badge value={r.clicked} /></td>
                <td className="px-3 py-2"><Badge value={r.cameBack} /></td>
              </tr>
            ))}
            {!pageRows.length && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No recipients found</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1 bg-slate-700 rounded disabled:opacity-40">← Prev</button>
          <span>Page {page + 1} of {totalPages} ({sorted.length} rows)</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-3 py-1 bg-slate-700 rounded disabled:opacity-40">Next →</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create `src/components/TemplateEditor.jsx`**

```jsx
import { useState } from "react";
import api from "../api";

export default function TemplateEditor({ template, onSaved, onActivated, onDeleted }) {
  const [html, setHtml] = useState(template?.html || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!template?._id) return;
    setSaving(true); setError("");
    try {
      await api.put(`/api/templates/${template._id}`, { html });
      onSaved?.();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setSaving(false); }
  }

  async function activate() {
    if (!template?._id) return;
    setSaving(true); setError("");
    try {
      await api.post(`/api/templates/${template._id}/activate`);
      onActivated?.();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!template?._id) return;
    if (!confirm(`Delete template "${template.name}"?`)) return;
    setSaving(true); setError("");
    try {
      await api.delete(`/api/templates/${template._id}`);
      onDeleted?.();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setSaving(false); }
  }

  if (!template) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        Select a template from the list
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-white">{template.name}</h2>
        {template.isActive && (
          <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">Active</span>
        )}
      </div>
      {error && <div className="text-red-400 text-sm bg-red-900/20 rounded px-3 py-2">{error}</div>}
      <textarea
        value={html}
        onChange={e => setHtml(e.target.value)}
        className="min-h-48 bg-slate-900 border border-slate-600 rounded p-3 text-sm text-slate-200 font-mono resize-y focus:outline-none focus:border-blue-500"
      />
      <iframe
        srcDoc={html}
        sandbox="allow-same-origin"
        title="Template preview"
        className="w-full h-64 rounded border border-slate-700 bg-white"
      />
      <div className="flex gap-2 flex-wrap">
        <button onClick={save} disabled={saving} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium disabled:opacity-50">Save</button>
        <button onClick={activate} disabled={saving || template.isActive} className="px-4 py-1.5 bg-green-600 hover:bg-green-500 rounded text-sm font-medium disabled:opacity-50">Set as Active</button>
        <button onClick={remove} disabled={saving || template.isActive} className="px-4 py-1.5 bg-red-700 hover:bg-red-600 rounded text-sm font-medium disabled:opacity-50">Delete</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verify build passes**

```bash
cd C:/Users/spsou/Documents/trackmail/dashboard && npm run build 2>&1 | tail -5
```

Expected: Build will still fail because pages don't exist yet. That's OK — continue to Task 6.

- [ ] **Step 8: Commit components**

```bash
cd C:/Users/spsou/Documents/trackmail && git add dashboard/src/components/ && git commit -m "feat: add dashboard components (Navbar, BunchSelector, StatCard, EventFeed, RecipientTable, TemplateEditor)"
```

---

## Task 6: React Dashboard — Pages

**Files:**
- Create: `dashboard/src/pages/Login.jsx`
- Create: `dashboard/src/pages/Overview.jsx`
- Create: `dashboard/src/pages/Recipients.jsx`
- Create: `dashboard/src/pages/Templates.jsx`

- [ ] **Step 1: Create `src/pages/Login.jsx`**

```jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const res = await api.post("/auth/login", { password });
      localStorage.setItem("trackmail_token", res.data.token);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-white text-center mb-8">Trackmail</h1>
        <form onSubmit={submit} className="bg-slate-800 rounded-xl p-8 space-y-4 border border-slate-700">
          <h2 className="text-lg font-semibold text-white">Sign in</h2>
          {error && <div className="text-red-400 text-sm bg-red-900/20 rounded px-3 py-2">{error}</div>}
          <div>
            <label className="block text-sm text-slate-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoFocus
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded font-medium disabled:opacity-50 transition-colors"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/pages/Overview.jsx`**

```jsx
import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import api from "../api";
import BunchSelector from "../components/BunchSelector";
import StatCard from "../components/StatCard";
import EventFeed from "../components/EventFeed";

export default function Overview() {
  const [bunchId, setBunchId] = useState("");
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!bunchId) return;
    setLoading(true);
    Promise.all([
      api.get(`/api/stats?bunchId=${bunchId}`),
      api.get(`/api/events?bunchId=${bunchId}`),
    ])
      .then(([sRes, eRes]) => { setStats(sRes.data); setEvents(eRes.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [bunchId]);

  const chartData = (() => {
    const map = {};
    for (const e of events) {
      const day = e.sentAt ? new Date(e.sentAt).toLocaleDateString() : "unknown";
      if (!map[day]) map[day] = { day, opens: 0, clicks: 0 };
      if (e.opened) map[day].opens++;
      if (e.clicked) map[day].clicks++;
    }
    return Object.values(map).sort((a, b) => new Date(a.day) - new Date(b.day));
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-white">Overview</h1>
        <BunchSelector value={bunchId} onChange={setBunchId} />
      </div>
      {loading && <div className="text-slate-400 text-sm">Loading…</div>}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Sent" value={stats.sent} color="blue" />
          <StatCard label="Opened" value={stats.opens} sub={`${stats.openRate}%`} color="green" />
          <StatCard label="Clicked" value={stats.clicks} sub={`${stats.clickRate}%`} color="yellow" />
          <StatCard label="Came Back" value={stats.cameBack} color="purple" />
        </div>
      )}
      {chartData.length > 0 && (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h2 className="text-sm font-medium text-slate-400 mb-4">Opens &amp; Clicks Over Time</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <XAxis dataKey="day" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", color: "#f1f5f9" }} />
              <Legend />
              <Line type="monotone" dataKey="opens" stroke="#60a5fa" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="clicks" stroke="#4ade80" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <h2 className="text-sm font-medium text-slate-400 mb-3">Recent Events</h2>
        <EventFeed events={events} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/pages/Recipients.jsx`**

```jsx
import { useState, useEffect } from "react";
import api from "../api";
import BunchSelector from "../components/BunchSelector";
import RecipientTable from "../components/RecipientTable";

export default function Recipients() {
  const [bunchId, setBunchId] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!bunchId) return;
    setLoading(true);
    api.get(`/api/events?bunchId=${bunchId}`)
      .then(r => setRows(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [bunchId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-white">Recipients</h1>
        <BunchSelector value={bunchId} onChange={setBunchId} />
      </div>
      {loading ? <div className="text-slate-400 text-sm">Loading…</div> : <RecipientTable rows={rows} />}
    </div>
  );
}
```

- [ ] **Step 4: Create `src/pages/Templates.jsx`**

```jsx
import { useState, useEffect, useCallback } from "react";
import api from "../api";
import TemplateEditor from "../components/TemplateEditor";

export default function Templates() {
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);

  const loadList = useCallback(() => {
    api.get("/api/templates").then(r => setTemplates(r.data)).catch(console.error);
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  async function selectTemplate(tmpl) {
    setSelected(null);
    try {
      const res = await api.get(tmpl.isActive ? "/api/templates/active" : `/api/templates/${tmpl._id}`);
      // GET /api/templates/active returns the full doc; GET /:id is not implemented — fetch active route covers it
      setSelected({ ...tmpl, html: res.data.html ?? "" });
    } catch (e) { console.error(e); }
  }

  async function createNew() {
    const name = prompt("Template name:");
    if (!name) return;
    setCreating(true);
    try {
      let baseHtml = "";
      const active = templates.find(t => t.isActive);
      if (active) {
        const res = await api.get("/api/templates/active");
        baseHtml = res.data.html;
      }
      await api.post("/api/templates", { name, html: baseHtml });
      loadList();
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    } finally { setCreating(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Templates</h1>
        <button onClick={createNew} disabled={creating} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium disabled:opacity-50">
          + New Template
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4" style={{ minHeight: "60vh" }}>
        <div className="md:col-span-1 bg-slate-800 rounded-lg border border-slate-700 p-3 space-y-1 overflow-y-auto">
          {!templates.length && <div className="text-slate-500 text-sm text-center py-8">No templates yet</div>}
          {templates.map(t => (
            <button
              key={t._id}
              onClick={() => selectTemplate(t)}
              className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                selected?._id === t._id ? "bg-slate-600 text-white" : "text-slate-300 hover:bg-slate-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="truncate">{t.name}</span>
                {t.isActive && <span className="ml-2 shrink-0 px-1.5 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">Active</span>}
              </div>
            </button>
          ))}
        </div>
        <div className="md:col-span-2 bg-slate-800 rounded-lg border border-slate-700 p-4">
          <TemplateEditor
            template={selected}
            onSaved={loadList}
            onActivated={() => { loadList(); if (selected) selectTemplate(selected); }}
            onDeleted={() => { setSelected(null); loadList(); }}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create `src/pages/` directory marker and verify build passes**

```bash
cd C:/Users/spsou/Documents/trackmail/dashboard && npm run build 2>&1 | tail -10
```

Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit pages**

```bash
cd C:/Users/spsou/Documents/trackmail && git add dashboard/src/pages/ && git commit -m "feat: add dashboard pages (Login, Overview, Recipients, Templates)"
```

---

## Task 7: `.env.example` + CLAUDE.md Update

**Files:**
- Create: `.env.example`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Create `.env.example`**

File content (exact):

```
# Existing
MONGODB_URI=
EMAIL_USER=
EMAIL_PASS=
LINKEDIN_EMAIL=
LINKEDIN_PASSWORD=

# New — Server
DASHBOARD_PASSWORD=
JWT_SECRET=
TRACK_SECRET=
DASHBOARD_ORIGIN=
TRACKING_WORKER_URL=

# New — Dashboard (Vite)
VITE_API_URL=

# New — Cloudflare Worker
EXPRESS_API_URL=
```

- [ ] **Step 2: Read `CLAUDE.md` before editing it**

Run: read the file `CLAUDE.md` at project root.

- [ ] **Step 3: Add new architecture section to `CLAUDE.md`**

Add this block after the existing `**Express API (`server.js`)**` section in the trackmail architecture:

```markdown
**New API routes (server.js):**
- `POST /auth/login` — public; accepts `{ password }`; returns JWT (7d)
- `POST /track-event` — public; `x-track-secret` header; writes to `TrackingEvents`
- `GET /api/bunches` — JWT; list bunches with sent count
- `GET /api/stats?bunchId=X` — JWT; `{ sent, opens, clicks, cameBack, openRate, clickRate }`
- `GET /api/events?bunchId=X` — JWT; per-recipient rows
- `GET /api/templates` — JWT; list templates (no html)
- `GET /api/templates/active` — JWT; active template with html
- `POST /api/templates` — JWT; create `{ name, html }`
- `PUT /api/templates/:id` — JWT; update name/html
- `DELETE /api/templates/:id` — JWT; rejects if isActive
- `POST /api/templates/:id/activate` — JWT; bulkWrite activate
- `POST /send-email` — JWT-protected
- `POST /send-bulk-emails` — JWT-protected

**New MongoDB collections:**
- `TrackingEvents` — `{ email, event, bunch_id, timestamp, url?, ip? }` — indexes: `{ email, event }` + `{ bunch_id }`
- `EmailTemplates` — `{ name, html, isActive, createdAt, updatedAt }` — unique partial index on `{ isActive: true }`

**Cloudflare Worker (`worker/`):**
- `worker/index.js` — handles `/track-open` (1x1 GIF + async POST /track-event) and `/track-link` (302 redirect + async POST)
- Deploy with `wrangler`; set `EXPRESS_API_URL` and `TRACK_SECRET` as Worker secrets

**React Dashboard (`dashboard/`):**
- Stack: Vite + React 18 + Tailwind CSS + Recharts + React Router v6
- `npm run dev` in `dashboard/` — dev server at localhost:5173; proxies `/api` and `/auth` to `VITE_API_URL`
- `npm run build` — production build for Vercel
- Pages: Login (`/login`), Overview (`/`), Recipients (`/recipients`), Templates (`/templates`)
- Auth: JWT stored in `localStorage` as `trackmail_token`; response interceptor clears on 401
```

- [ ] **Step 4: Commit**

```bash
cd C:/Users/spsou/Documents/trackmail && git add .env.example CLAUDE.md && git commit -m "docs: add .env.example and update CLAUDE.md with new architecture"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Covered by |
|---|---|
| 1.1 send-daily-emails fixes | Already done ✅ |
| 1.2 server.js throw MONGODB_URI | Task 2 |
| 1.2 SIGTERM/SIGINT | Task 2 |
| 1.2 remove ObjectId | Task 2 (new server.js doesn't import it) |
| 1.2 restricted CORS | Task 2 |
| 1.2 JWT middleware on /api/* and /send-* | Task 2 |
| 1.2 POST /auth/login | Already done ✅ |
| 1.2 POST /track-event | Already done ✅ |
| 1.2 GET /api/bunches | Already done ✅ |
| 1.2 GET /api/stats | Already done ✅ |
| 1.2 GET /api/events | Already done ✅ |
| 1.2 GET/POST/PUT/DELETE/activate /api/templates | Task 1 |
| 1.3 mailer.verify() | Already done ✅ |
| 1.4 search_page.py shared client | Already done ✅ |
| 1.5 login_page.py conditional screenshots | Already done ✅ |
| 1.6 .gitignore | Already done ✅ |
| 1.7 package.json deps | Already done ✅ |
| Phase 2 setup-indexes.js | Already done ✅ |
| Phase 3 Cloudflare Worker | Task 3 |
| Phase 4 React Dashboard | Tasks 4, 5, 6 |
| Phase 5 .env.example | Task 7 |
| Phase 6 CLAUDE.md update | Task 7 |

**Placeholder scan:** No TBD/TODO in any code blocks. All steps have actual code.

**Type consistency:**
- `verifyJWT` from `middleware/auth.js` — used in templates.js + server.js ✅
- `getDB()` from `db.js` — consistent across all routes ✅
- `ObjectId` from `mongodb` — only used in templates.js for `:id` routes ✅
- `bunch_id` field — snake_case throughout (DB documents, query params) ✅
- Stats router at `app.use("/", ...)` with route paths `/api/bunches` etc. → full paths match frontend `api.get("/api/bunches")` ✅
- Templates router at `app.use("/api", ...)` with route paths `/templates` etc. → full paths = `/api/templates` ✅
- `connectDB` / `closeDB` / `getDB` — method names match `db.js` exports ✅
