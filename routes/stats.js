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

    const trackingCollection = db.collection("TrackingEvents");
    const aggregateMock = trackingCollection.aggregate([
      { $match: { bunch_id: bunchId } },
      { $group: { _id: { email: "$email", event: "$event" } } },
      { $group: { _id: "$_id.event", count: { $sum: 1 } } },
    ]);

    const [sent, eventGroups, comebackData] = await Promise.all([
      db.collection("AlreadySent").countDocuments({ bunch_id: bunchId }),
      aggregateMock.toArray(),
      trackingCollection.aggregate([
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
