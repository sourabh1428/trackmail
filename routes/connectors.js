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
      db.collection("ConnectorConfigs").find({}, { projection: { credentials: 0 } }).sort({ order: 1 }).toArray(),
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
    return res.status(400).json({ error: "Body must contain at least one connector key (ses, gmail, gmail2, gmail3, resend)" });
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

router.put("/:name", async (req, res) => {
  const { name } = req.params;
  if (!VALID_CONNECTORS.includes(name)) return res.status(400).json({ error: `Unknown connector: ${name}` });
  const { enabled, dailyLimit } = req.body || {};
  const update = { updatedAt: new Date() };
  if (typeof enabled === "boolean") update.enabled = enabled;
  if (Number.isInteger(dailyLimit) && dailyLimit > 0) update.dailyLimit = dailyLimit;
  if (Object.keys(update).length === 1) return res.status(400).json({ error: "enabled or dailyLimit required" });
  try {
    await getDB().collection("ConnectorConfigs").updateOne(
      { name },
      { $set: update, $setOnInsert: { name, order: VALID_CONNECTORS.indexOf(name) + 1 } },
      { upsert: true }
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error("[api/connectors PUT /:name]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

const CONNECTOR_REQUIRED_FIELDS = {
  ses: ["accessKeyId", "secretAccessKey", "region", "fromEmail"],
  gmail: ["email", "appPassword"],
  gmail2: ["email", "appPassword"],
  gmail3: ["email", "appPassword"],
  gmail4: ["email", "appPassword"],
  resend: ["apiKey"],
};

router.put("/:name/credentials", async (req, res) => {
  const { name } = req.params;
  if (!VALID_CONNECTORS.includes(name)) return res.status(400).json({ error: `Unknown connector: ${name}` });
  const required = CONNECTOR_REQUIRED_FIELDS[name] || [];
  const missing = required.filter(k => !req.body?.[k]);
  if (missing.length) return res.status(400).json({ error: `Missing fields: ${missing.join(", ")}` });
  const credentials = {};
  for (const key of required) credentials[key] = req.body[key];
  try {
    await getDB().collection("ConnectorConfigs").updateOne(
      { name },
      {
        $set: { credentials, updatedAt: new Date() },
        $setOnInsert: { name, enabled: true, order: VALID_CONNECTORS.indexOf(name) + 1 },
      },
      { upsert: true }
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error("[api/connectors credentials PUT]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.delete("/:name/credentials", async (req, res) => {
  const { name } = req.params;
  if (!VALID_CONNECTORS.includes(name)) return res.status(400).json({ error: `Unknown connector: ${name}` });
  try {
    await getDB().collection("ConnectorConfigs").updateOne({ name }, { $unset: { credentials: "" } });
    return res.json({ ok: true });
  } catch (e) {
    console.error("[api/connectors credentials DELETE]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
