"use strict";

const router = require("express").Router();
const { verifyJWT } = require("../middleware/auth");
const { getDB } = require("../db");

router.use(verifyJWT);

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

router.get("/api/stats", async (req, res) => {
  const { bunchId } = req.query;
  if (!bunchId) return res.status(400).json({ error: "bunchId query param required" });

  try {
    const db = getDB();
    const workerBase = process.env.TRACKING_WORKER_URL;
    const trackSecret = process.env.TRACK_SECRET;

    const [sent, workerRes] = await Promise.all([
      db.collection("AlreadySent").countDocuments({ bunch_id: bunchId }),
      fetch(`${workerBase}/d1/stats?bunch_id=${encodeURIComponent(bunchId)}`, {
        headers: { "x-track-secret": trackSecret },
      }),
    ]);

    if (!workerRes.ok) {
      const text = await workerRes.text();
      console.error("[api/stats] worker error:", workerRes.status, text);
      return res.status(502).json({ error: "Failed to fetch tracking stats from worker" });
    }

    const { opens, clicks, cameBack } = await workerRes.json();

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

router.get("/api/events", async (req, res) => {
  const { bunchId } = req.query;
  if (!bunchId) return res.status(400).json({ error: "bunchId query param required" });

  try {
    const db = getDB();
    const workerBase = process.env.TRACKING_WORKER_URL;
    const trackSecret = process.env.TRACK_SECRET;

    const [sentDocs, workerRes] = await Promise.all([
      db.collection("AlreadySent")
        .find({ bunch_id: bunchId })
        .project({ email: 1, sentAt: 1, _id: 0 })
        .toArray(),
      fetch(`${workerBase}/d1/events?bunch_id=${encodeURIComponent(bunchId)}`, {
        headers: { "x-track-secret": trackSecret },
      }),
    ]);

    if (!workerRes.ok) {
      const text = await workerRes.text();
      console.error("[api/events] worker error:", workerRes.status, text);
      return res.status(502).json({ error: "Failed to fetch tracking events from worker" });
    }

    const trackRows = await workerRes.json(); // [{ email, event, timestamp, url }]

    const map = {};
    for (const s of sentDocs) {
      map[s.email] = { email: s.email, sentAt: s.sentAt, opened: false, clicked: false, clickCount: 0 };
    }
    for (const t of trackRows) {
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
