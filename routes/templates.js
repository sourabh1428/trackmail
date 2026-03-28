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
