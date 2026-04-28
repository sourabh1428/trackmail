"use strict";

const router = require("express").Router();
const { verifyJWT } = require("../middleware/auth");
const { getDB } = require("../db");

router.use(verifyJWT);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function domainFromEmail(email = "") {
  const parts = String(email).split("@");
  return parts.length > 1 ? parts[1].toLowerCase() : "";
}

function companyFromRecipient(doc, email) {
  if (doc.company) return doc.company;
  const domain = domainFromEmail(email);
  if (!domain) return "Unknown";
  return domain.split(".")[0].replace(/[-_]/g, " ");
}

function latestDate(...dates) {
  return dates
    .filter(Boolean)
    .map((d) => new Date(d))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => b - a)[0] || null;
}

function stageFor(row) {
  if (row.replyStage && row.replyStage !== "replied") return row.replyStage;
  if (row.replied) return "replied";
  if (row.clicked) return "clicked";
  if (row.opened) return "opened";
  return "sent";
}

async function getRecipientSnapshots({ bunchId } = {}) {
  const db = getDB();
  const sentFilter = bunchId ? { bunch_id: bunchId } : {};
  const eventFilter = bunchId ? { bunch_id: bunchId } : {};

  const [sentDocs, events, replies] = await Promise.all([
    db.collection("AlreadySent").find(sentFilter).toArray(),
    db.collection("TrackingEvents").find(eventFilter).sort({ timestamp: -1 }).toArray(),
    db.collection("Replies").find({}).sort({ repliedAt: -1 }).toArray().catch(() => []),
  ]);

  const rows = new Map();
  for (const doc of sentDocs) {
    const email = normalizeEmail(doc.email || doc.to);
    if (!email) continue;
    rows.set(email, {
      email,
      bunchId: doc.bunch_id || doc.bunchId || "",
      sentAt: doc.sentAt || doc.createdAt || null,
      company: companyFromRecipient(doc, email),
      role: doc.role || "",
      templateId: doc.templateId || doc.template_id || "",
      opened: Boolean(doc.opened),
      openedAt: doc.openedAt || null,
      clicked: Boolean(doc.clicked),
      clickedAt: doc.clickedAt || null,
      replied: Boolean(doc.replied),
      repliedAt: doc.repliedAt || null,
      replyStage: doc.stage || null,
      openCount: Number(doc.openCount || 0),
      clickCount: Number(doc.clickCount || 0),
      followUpNumber: Number(doc.followUpNumber || 0),
      lastActivity: latestDate(doc.repliedAt, doc.clickedAt, doc.openedAt, doc.sentAt, doc.createdAt),
    });
  }

  for (const event of events) {
    const email = normalizeEmail(event.email);
    if (!email) continue;
    if (!rows.has(email)) {
      rows.set(email, {
        email,
        bunchId: event.bunch_id || "",
        sentAt: null,
        company: companyFromRecipient({}, email),
        role: "",
        templateId: "",
        opened: false,
        openedAt: null,
        clicked: false,
        clickedAt: null,
        replied: false,
        repliedAt: null,
        replyStage: null,
        openCount: 0,
        clickCount: 0,
        followUpNumber: 0,
        lastActivity: null,
      });
    }
    const row = rows.get(email);
    const ts = event.timestamp || event.createdAt;
    if (event.event === "open") {
      row.opened = true;
      row.openCount += 1;
      row.openedAt = latestDate(row.openedAt, ts);
    }
    if (event.event === "click") {
      row.clicked = true;
      row.clickCount += 1;
      row.clickedAt = latestDate(row.clickedAt, ts);
    }
    row.lastActivity = latestDate(row.lastActivity, ts);
  }

  for (const reply of replies) {
    const email = normalizeEmail(reply.email);
    const row = rows.get(email);
    if (!row) continue;
    row.replied = true;
    row.repliedAt = latestDate(row.repliedAt, reply.repliedAt, reply.createdAt);
    row.replyStage = reply.stage || row.replyStage || "replied";
    row.sentiment = reply.sentiment || "neutral";
    row.notes = reply.notes || "";
    row.lastActivity = latestDate(row.lastActivity, row.repliedAt);
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      stage: stageFor(row),
      cameBack: row.clickCount > 1,
    }))
    .sort((a, b) => new Date(b.lastActivity || b.sentAt || 0) - new Date(a.lastActivity || a.sentAt || 0));
}

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

    if (!workerBase) {
      const trackingEvents = db.collection("TrackingEvents");
      const [sent, eventCounts, comebackRows] = await Promise.all([
        db.collection("AlreadySent").countDocuments({ bunch_id: bunchId }),
        trackingEvents.aggregate([
          { $match: { bunch_id: bunchId, event: { $in: ["open", "click"] } } },
          { $group: { _id: "$event", count: { $sum: 1 } } },
        ]).toArray(),
        trackingEvents.aggregate([
          { $match: { bunch_id: bunchId, event: "click" } },
          { $group: { _id: "$email", count: { $sum: 1 } } },
          { $match: { count: { $gt: 1 } } },
          { $count: "total" },
        ]).toArray(),
      ]);
      const counts = Object.fromEntries(eventCounts.map((row) => [row._id, row.count]));
      const opens = counts.open || 0;
      const clicks = counts.click || 0;
      const cameBack = comebackRows[0]?.total || 0;
      return res.json({
        sent,
        opens,
        clicks,
        cameBack,
        openRate: sent > 0 ? Math.round((opens / sent) * 100) : 0,
        clickRate: sent > 0 ? Math.round((clicks / sent) * 100) : 0,
      });
    }

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

router.get("/api/timeline", async (req, res) => {
  const { bunchId } = req.query;
  if (!bunchId) return res.status(400).json({ error: "bunchId query param required" });

  try {
    const workerBase = process.env.TRACKING_WORKER_URL;
    const trackSecret = process.env.TRACK_SECRET;

    const workerRes = await fetch(`${workerBase}/d1/timeline?bunch_id=${encodeURIComponent(bunchId)}`, {
      headers: { "x-track-secret": trackSecret },
    });

    if (!workerRes.ok) {
      const text = await workerRes.text();
      console.error("[api/timeline] worker error:", workerRes.status, text);
      return res.status(502).json({ error: "Failed to fetch timeline from worker" });
    }

    const rows = await workerRes.json();
    return res.json(rows);
  } catch (e) {
    console.error("[api/timeline]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.get("/api/domains", async (req, res) => {
  const { bunchId } = req.query;
  if (!bunchId) return res.status(400).json({ error: "bunchId query param required" });

  try {
    const db = getDB();
    const workerBase = process.env.TRACKING_WORKER_URL;
    const trackSecret = process.env.TRACK_SECRET;

    const [sentDocs, workerRes] = await Promise.all([
      db.collection("AlreadySent").aggregate([
        { $match: { bunch_id: bunchId } },
        { $group: { _id: { $arrayElemAt: [{ $split: ["$email", "@"] }, 1] }, sent: { $sum: 1 } } },
        { $project: { _id: 0, domain: "$_id", sent: 1 } },
      ]).toArray(),
      fetch(`${workerBase}/d1/events?bunch_id=${encodeURIComponent(bunchId)}`, {
        headers: { "x-track-secret": trackSecret },
      }),
    ]);

    if (!workerRes.ok) {
      const text = await workerRes.text();
      console.error("[api/domains] worker error:", workerRes.status, text);
      return res.status(502).json({ error: "Failed to fetch tracking events from worker" });
    }

    const trackRows = await workerRes.json(); // [{ email, event, timestamp, url }]

    // Build sent map: domain -> sent count
    const sentMap = {};
    for (const s of sentDocs) {
      if (s.domain) sentMap[s.domain] = s.sent;
    }

    // Count distinct open/click per email, then group by domain
    const emailOpened = {};
    const emailClicked = {};
    for (const t of trackRows) {
      const domain = t.email.split("@")[1];
      if (!domain) continue;
      if (t.event === "open") emailOpened[t.email] = domain;
      if (t.event === "click") emailClicked[t.email] = domain;
    }

    const opensMap = {};
    const clicksMap = {};
    for (const domain of Object.values(emailOpened)) {
      opensMap[domain] = (opensMap[domain] ?? 0) + 1;
    }
    for (const domain of Object.values(emailClicked)) {
      clicksMap[domain] = (clicksMap[domain] ?? 0) + 1;
    }

    // Merge and compute openRate
    const allDomains = new Set([...Object.keys(sentMap), ...Object.keys(opensMap), ...Object.keys(clicksMap)]);
    const rows = [];
    for (const domain of allDomains) {
      const sent = sentMap[domain] ?? 0;
      if (sent < 1) continue;
      const opens = opensMap[domain] ?? 0;
      const clicks = clicksMap[domain] ?? 0;
      rows.push({ domain, sent, opens, clicks, openRate: Math.round((opens / sent) * 100) });
    }
    rows.sort((a, b) => b.sent - a.sent);

    return res.json(rows);
  } catch (e) {
    console.error("[api/domains]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.get("/api/recipients", async (req, res) => {
  try {
    const rows = await getRecipientSnapshots({ bunchId: req.query.bunchId });
    return res.json(rows);
  } catch (e) {
    console.error("[api/recipients]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.get("/api/follow-ups", async (req, res) => {
  try {
    const rows = await getRecipientSnapshots();
    const now = Date.now();
    const twoDaysAgo = now - (2 * MS_PER_DAY);
    const sevenDaysAgo = now - (7 * MS_PER_DAY);
    const twoDaysFromNow = now + (2 * MS_PER_DAY);

    const followUpNow = rows
      .filter((r) => r.opened && !r.replied && r.openedAt)
      .filter((r) => {
        const openedAt = new Date(r.openedAt).getTime();
        return openedAt <= twoDaysAgo && openedAt >= sevenDaysAgo;
      })
      .slice(0, 8);

    const hotLeads = rows
      .filter((r) => !r.replied)
      .filter((r) => r.openCount >= 3 || (r.clickedAt && new Date(r.clickedAt).getTime() >= now - (2 * MS_PER_DAY)))
      .slice(0, 8);

    const newReplies = rows
      .filter((r) => r.replied && r.repliedAt && new Date(r.repliedAt).getTime() >= sevenDaysAgo)
      .slice(0, 8);

    const dueSoon = rows
      .filter((r) => r.followUpDate)
      .filter((r) => {
        const due = new Date(r.followUpDate).getTime();
        return due >= now && due <= twoDaysFromNow;
      });

    return res.json({ followUpNow, hotLeads, newReplies, dueSoon });
  } catch (e) {
    console.error("[api/follow-ups]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.get("/api/pipeline", async (req, res) => {
  try {
    const rows = await getRecipientSnapshots();
    const counts = {
      sent: rows.length,
      opened: rows.filter((r) => r.opened).length,
      clicked: rows.filter((r) => r.clicked).length,
      replied: rows.filter((r) => r.replied).length,
      interview: rows.filter((r) => r.stage === "interview_scheduled" || r.stage === "interview").length,
      offer: rows.filter((r) => r.stage === "offer").length,
      rejected: rows.filter((r) => r.stage === "rejected").length,
    };

    return res.json([
      { key: "sent", label: "Sent", count: counts.sent },
      { key: "opened", label: "Opened", count: counts.opened },
      { key: "clicked", label: "Clicked", count: counts.clicked },
      { key: "replied", label: "Replied", count: counts.replied },
      { key: "interview", label: "Interview", count: counts.interview },
      { key: "offer", label: "Offer", count: counts.offer },
    ]);
  } catch (e) {
    console.error("[api/pipeline]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.get("/api/companies", async (req, res) => {
  try {
    const rows = await getRecipientSnapshots();
    const companies = new Map();
    for (const row of rows) {
      const key = row.company || domainFromEmail(row.email) || "Unknown";
      if (!companies.has(key)) {
        companies.set(key, {
          company: key,
          domain: domainFromEmail(row.email),
          peopleContacted: 0,
          opened: 0,
          replied: 0,
          bestStage: "sent",
          lastActivity: null,
          recipients: [],
        });
      }
      const company = companies.get(key);
      company.peopleContacted += 1;
      if (row.opened) company.opened += 1;
      if (row.replied) company.replied += 1;
      const stageRank = { sent: 1, opened: 2, clicked: 3, replied: 4, interview_scheduled: 5, interview: 5, offer: 6, rejected: 0 };
      if ((stageRank[row.stage] || 0) > (stageRank[company.bestStage] || 0)) company.bestStage = row.stage;
      company.lastActivity = latestDate(company.lastActivity, row.lastActivity);
      company.recipients.push(row);
    }

    const result = [...companies.values()]
      .map((company) => ({
        ...company,
        openRate: company.peopleContacted ? Math.round((company.opened / company.peopleContacted) * 100) : 0,
        spamRisk: company.peopleContacted >= 3 && company.opened === 0,
      }))
      .sort((a, b) => new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0));

    return res.json(result);
  } catch (e) {
    console.error("[api/companies]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.get("/api/daily-digest", async (req, res) => {
  try {
    const rows = await getRecipientSnapshots();
    const now = Date.now();
    const weekAgo = now - (7 * MS_PER_DAY);
    const twoWeeksAgo = now - (14 * MS_PER_DAY);

    const inRange = (date, start, end) => {
      const time = date ? new Date(date).getTime() : 0;
      return time >= start && time < end;
    };
    const summarize = (start, end) => {
      const sent = rows.filter((r) => inRange(r.sentAt, start, end));
      return {
        sent: sent.length,
        openRate: sent.length ? Math.round((sent.filter((r) => r.opened).length / sent.length) * 100) : 0,
        replies: rows.filter((r) => inRange(r.repliedAt, start, end)).length,
        clicks: rows.filter((r) => inRange(r.clickedAt, start, end)).length,
      };
    };

    return res.json({
      thisWeek: summarize(weekAgo, now + 1),
      lastWeek: summarize(twoWeeksAgo, weekAgo),
    });
  } catch (e) {
    console.error("[api/daily-digest]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.post("/api/replies", async (req, res) => {
  const { email, sentiment = "neutral", notes = "", stage = "replied", repliedAt } = req.body || {};
  if (!email) return res.status(400).json({ error: "email is required" });
  try {
    const now = new Date();
    const replyDate = repliedAt ? new Date(repliedAt) : now;
    const doc = {
      email: normalizeEmail(email),
      sentiment,
      notes,
      stage,
      repliedAt: replyDate,
      createdAt: now,
      updatedAt: now,
    };
    await getDB().collection("Replies").insertOne(doc);
    await getDB().collection("AlreadySent").updateOne(
      { email: normalizeEmail(email) },
      { $set: { replied: true, repliedAt: replyDate, stage, updatedAt: now } }
    );
    return res.status(201).json({ ok: true, reply: doc });
  } catch (e) {
    console.error("[api/replies]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.put("/api/recipients/:email/stage", async (req, res) => {
  const email = normalizeEmail(req.params.email);
  const { stage } = req.body || {};
  if (!stage) return res.status(400).json({ error: "stage is required" });
  try {
    const result = await getDB().collection("AlreadySent").updateOne(
      { email },
      { $set: { stage, updatedAt: new Date() } }
    );
    if (!result.matchedCount) return res.status(404).json({ error: "Recipient not found" });
    return res.json({ ok: true });
  } catch (e) {
    console.error("[api/recipients/stage]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.get("/api/template-comparison", async (req, res) => {
  try {
    const rows = await getRecipientSnapshots();
    const grouped = new Map();
    for (const row of rows) {
      const key = row.templateId || "unknown";
      if (!grouped.has(key)) grouped.set(key, { template: key, timesUsed: 0, opened: 0, clicked: 0, replied: 0 });
      const item = grouped.get(key);
      item.timesUsed += 1;
      if (row.opened) item.opened += 1;
      if (row.clicked) item.clicked += 1;
      if (row.replied) item.replied += 1;
    }
    const result = [...grouped.values()].map((item) => ({
      ...item,
      openRate: item.timesUsed ? Math.round((item.opened / item.timesUsed) * 100) : 0,
      clickRate: item.timesUsed ? Math.round((item.clicked / item.timesUsed) * 100) : 0,
      replyRate: item.timesUsed ? Math.round((item.replied / item.timesUsed) * 1000) / 10 : 0,
    })).sort((a, b) => b.replyRate - a.replyRate || b.openRate - a.openRate);
    return res.json(result);
  } catch (e) {
    console.error("[api/template-comparison]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.get("/api/analytics", async (req, res) => {
  try {
    const rows = await getRecipientSnapshots();
    const weeks = new Map();
    const domains = new Map();
    const responseLag = [];
    const sendTime = Array.from({ length: 7 }, (_, day) => ({ day, hours: Array.from({ length: 24 }, (_, hour) => ({ hour, opens: 0 })) }));

    for (const row of rows) {
      const sentAt = row.sentAt ? new Date(row.sentAt) : null;
      if (sentAt && !Number.isNaN(sentAt.getTime())) {
        const week = sentAt.toISOString().slice(0, 10);
        if (!weeks.has(week)) weeks.set(week, { week, sent: 0, opened: 0, replied: 0 });
        const item = weeks.get(week);
        item.sent += 1;
        if (row.opened) item.opened += 1;
        if (row.replied) item.replied += 1;
      }
      if (row.openedAt) {
        const openedAt = new Date(row.openedAt);
        sendTime[openedAt.getDay()].hours[openedAt.getHours()].opens += 1;
        if (sentAt) responseLag.push({ email: row.email, hours: Math.round((openedAt - sentAt) / (60 * 60 * 1000)) });
      }
      const domain = domainFromEmail(row.email);
      if (domain) {
        if (!domains.has(domain)) domains.set(domain, { domain, sent: 0, opened: 0 });
        const item = domains.get(domain);
        item.sent += 1;
        if (row.opened) item.opened += 1;
      }
    }

    const deliverability = [...domains.values()]
      .map((d) => ({ ...d, openRate: d.sent ? Math.round((d.opened / d.sent) * 100) : 0, flagged: d.sent >= 20 && d.opened === 0 }))
      .sort((a, b) => b.sent - a.sent)
      .slice(0, 20);

    return res.json({
      weeklyTrends: [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)).slice(-8),
      sendTime,
      responseLag,
      deliverability,
    });
  } catch (e) {
    console.error("[api/analytics]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
