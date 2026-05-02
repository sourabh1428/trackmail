"use strict";

const router = require("express").Router();
const { verifyJWT } = require("../middleware/auth");
const { getDB } = require("../db");
const { VALID_CONNECTORS, getISTDate } = require("../connectors");

router.use(verifyJWT);

router.get("/", async (req, res) => {
  try {
    const db = getDB();
    const istDate = getISTDate();

    const [configs, usageDocs] = await Promise.all([
      db.collection("ConnectorConfigs").find({}).sort({ order: 1 }).toArray(),
      db.collection("ConnectorUsage").find({ istDate }).toArray(),
    ]);

    const usageMap = {};
    for (const doc of usageDocs) usageMap[doc.name] = doc.sent;

    const result = configs.map(c => ({
      name: c.name,
      order: c.order,
      dailyLimit: c.dailyLimit,
      enabled: c.enabled,
      sentToday: usageMap[c.name] || 0,
      remaining: Math.max(0, c.dailyLimit - (usageMap[c.name] || 0)),
    }));

    return res.json(result);
  } catch (e) {
    console.error("[api/connectors GET]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.put("/limits", async (req, res) => {
  const body = req.body || {};
  const keys = Object.keys(body);

  if (!keys.length) {
    return res.status(400).json({ error: "Body must contain at least one connector key (ses, gmail, resend)" });
  }

  const unknown = keys.filter(k => !VALID_CONNECTORS.includes(k));
  if (unknown.length) {
    return res.status(400).json({ error: `Unknown connectors: ${unknown.join(", ")}. Valid: ${VALID_CONNECTORS.join(", ")}` });
  }

  for (const [name, limit] of Object.entries(body)) {
    if (!Number.isInteger(limit) || limit <= 0) {
      return res.status(400).json({ error: `dailyLimit for "${name}" must be a positive integer` });
    }
  }

  try {
    const db = getDB();
    const updated = [];

    for (const [name, dailyLimit] of Object.entries(body)) {
      await db.collection("ConnectorConfigs").updateOne(
        { name },
        {
          $set: { dailyLimit },
          $setOnInsert: { enabled: true, order: VALID_CONNECTORS.indexOf(name) + 1 },
        },
        { upsert: true }
      );
      updated.push(name);
    }

    return res.json({ ok: true, updated });
  } catch (e) {
    console.error("[api/connectors PUT]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
