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
