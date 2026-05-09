"use strict";

const router = require("express").Router();
const { ObjectId } = require("mongodb");
const { verifyJWT } = require("../middleware/auth");
const { getDB } = require("../db");
const { spawn } = require("child_process");
const path = require("path");

const LogBus = (() => {
  const subscribers = new Map();
  return {
    subscribe(runId, res) {
      if (!subscribers.has(runId)) subscribers.set(runId, new Set());
      subscribers.get(runId).add(res);
    },
    unsubscribe(runId, res) {
      subscribers.get(runId)?.delete(res);
    },
    emit(runId, line) {
      if (!line) return;
      const subs = subscribers.get(runId);
      if (!subs) return;
      const payload = `data: ${JSON.stringify({ line, ts: Date.now() })}\n\n`;
      for (const res of subs) {
        try { res.write(payload); } catch {}
      }
    },
    close(runId) {
      const subs = subscribers.get(runId);
      if (!subs) return;
      for (const res of subs) {
        try { res.write("event: done\ndata: {}\n\n"); res.end(); } catch {}
      }
      subscribers.delete(runId);
    },
  };
})();

function spawnScraperProcess(runId, db) {
  const scraperDir = path.resolve(__dirname, "../scraper");
  const proc = spawn("python", ["main.py"], {
    cwd: scraperDir,
    env: {
      ...process.env,
      SCRAPER_LINKS_SOURCE: "api",
      SCRAPER_API_URL: `http://localhost:${process.env.PORT || 3000}`,
      SCRAPER_INTERNAL_TOKEN: process.env.SCRAPER_INTERNAL_TOKEN || "",
      HEADLESS_MODE: "true",
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    },
  });

  const pushLine = (line) => { if (line.trim()) LogBus.emit(runId, line.trim()); };
  proc.stdout.on("data", (chunk) => chunk.toString("utf8").split("\n").forEach(pushLine));
  proc.stderr.on("data", (chunk) => chunk.toString("utf8").split("\n").forEach(pushLine));

  proc.on("close", async (code) => {
    try {
      await db.collection("ScraperRuns").updateOne(
        { _id: new ObjectId(runId) },
        { $set: { status: code === 0 ? "done" : "error", exitCode: code, finishedAt: new Date() } }
      );
    } catch {}
    LogBus.close(runId);
  });
}

router.use(verifyJWT);

router.get("/links", async (req, res) => {
  try {
    const links = await getDB().collection("ScraperLinks")
      .find({})
      .sort({ createdAt: 1 })
      .project({ url: 1, label: 1, enabled: 1, createdAt: 1 })
      .toArray();
    return res.json(links);
  } catch (e) {
    console.error("[api/scraper/links GET]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.post("/links", async (req, res) => {
  const { url, label = "" } = req.body || {};
  if (!url) return res.status(400).json({ error: "url is required" });
  if (!url.toLowerCase().startsWith("https://www.linkedin.com/search/results/")) {
    return res.status(400).json({ error: "url must be a LinkedIn search results URL" });
  }
  try {
    const now = new Date();
    const result = await getDB().collection("ScraperLinks").insertOne({
      url, label, enabled: true, createdAt: now, updatedAt: now,
    });
    return res.status(201).json({ _id: result.insertedId, url, label, enabled: true, createdAt: now });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: "URL already exists" });
    console.error("[api/scraper/links POST]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.delete("/links/:id", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const result = await getDB().collection("ScraperLinks").deleteOne({ _id: new ObjectId(req.params.id) });
    if (!result.deletedCount) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (e) {
    console.error("[api/scraper/links DELETE]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.patch("/links/:id", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid id" });
  const { enabled, label } = req.body || {};
  const update = { updatedAt: new Date() };
  if (typeof enabled === "boolean") update.enabled = enabled;
  if (typeof label === "string") update.label = label;
  try {
    const result = await getDB().collection("ScraperLinks").updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: update }
    );
    if (!result.matchedCount) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (e) {
    console.error("[api/scraper/links PATCH]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.get("/status", async (req, res) => {
  try {
    const active = await getDB().collection("ScraperRuns").findOne({ status: "running" });
    if (active) return res.json({ status: "running", runId: active._id, startedAt: active.startedAt });
    return res.json({ status: "idle" });
  } catch (e) {
    console.error("[api/scraper/status]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.post("/run", async (req, res) => {
  try {
    const db = getDB();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await db.collection("ScraperRuns").updateMany(
      { status: "running", startedAt: { $lt: twoHoursAgo } },
      { $set: { status: "error", exitCode: -1, finishedAt: new Date() } }
    );
    const active = await db.collection("ScraperRuns").findOne({ status: "running" });
    if (active) return res.status(409).json({ error: "Scraper already running", runId: active._id });

    const { insertedId } = await db.collection("ScraperRuns").insertOne({
      startedAt: new Date(),
      finishedAt: null,
      status: "running",
      exitCode: null,
      triggeredBy: "ui",
    });

    const runId = insertedId.toString();
    spawnScraperProcess(runId, db);

    return res.json({ ok: true, runId });
  } catch (e) {
    console.error("[api/scraper/run]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.get("/logs/:runId", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const { runId } = req.params;
  LogBus.subscribe(runId, res);
  req.on("close", () => LogBus.unsubscribe(runId, res));
});

module.exports = router;
