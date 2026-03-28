"use strict";

const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const cors = require("cors");
const morgan = require("morgan");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

const { sendEmail } = require("./mailer");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cors());
app.use(morgan("combined"));

const {
	MONGODB_URI,
	PORT = 3000,
} = process.env;

if (!MONGODB_URI) {
	console.warn("[server] MONGODB_URI is not set. Set it in environment variables.");
}

let mongoClient;
let db;
let emailsCollection;
let alreadySentCollection;

async function connectMongo() {
	if (db) return db;
	mongoClient = new MongoClient(MONGODB_URI, {
		maxPoolSize: 10,
		serverSelectionTimeoutMS: 20000,
	});
	await mongoClient.connect();
	db = mongoClient.db("Linkedin_scrape");
	emailsCollection = db.collection("Emails");
	alreadySentCollection = db.collection("AlreadySent");
	return db;
}


async function retry(fn, { retries = 3, baseDelayMs = 500 }) {
	let attempt = 0;
	while (true) {
		try {
			return await fn();
		} catch (err) {
			attempt++;
			if (attempt > retries) throw err;
			const delay = baseDelayMs * Math.pow(2, attempt - 1);
			await new Promise((res) => setTimeout(res, delay));
		}
	}
}

app.get("/health", async (req, res) => {
	try {
		await connectMongo();
		await db.command({ ping: 1 });
		return res.json({ ok: true });
	} catch (e) {
		return res.status(500).json({ ok: false, error: e.message });
	}
});

// POST /send-email { to, subject, html, text, variables, trackId }
app.post("/send-email", async (req, res) => {
	const { to, subject, html, text, trackId } = req.body || {};
	if (!to || !subject || (!html && !text)) {
		return res.status(400).json({ error: "Missing required fields: to, subject, html|text" });
	}
	try {
		await connectMongo();

		const result = await retry(() => sendEmail({
			to,
			subject,
			html,
			text,
		}), { retries: 3, baseDelayMs: 1000 });

		if (trackId) {
			await alreadySentCollection.updateOne(
				{ trackId },
				{ $set: { trackId, to, subject, sentAt: new Date(), messageId: result.messageId } },
				{ upsert: true }
			);
		}

		console.log(`[send-email] SUCCESS to=${to} subject="${subject}"`);
		return res.json({ ok: true, result });
	} catch (e) {
		console.error(`[send-email] FAIL to=${to} subject="${subject}" error=${e.message}`);
		return res.status(500).json({ ok: false, error: e.message });
	}
});

// POST /send-bulk-emails { bunchID, subject, htmlTemplate, textTemplate, defaultVariables }
app.post("/send-bulk-emails", async (req, res) => {
	const { bunchID, subject, htmlTemplate, textTemplate } = req.body || {};
	if (!bunchID || !subject || (!htmlTemplate && !textTemplate)) {
		return res.status(400).json({ error: "Missing required fields: bunchID, subject, htmlTemplate|textTemplate" });
	}
	try {
		await connectMongo();

		// Get recipients by bunch_id (DB field)
		const recipientsCursor = emailsCollection.find({ bunch_id: bunchID });
		const recipients = await recipientsCursor.toArray();

		if (!recipients.length) {
			return res.json({ ok: true, message: "No recipients found for bunchID", sent: 0 });
		}

		// Fetch AlreadySent map for this bunch to skip duplicates
		const alreadySentDocs = await alreadySentCollection.find({ bunch_id: bunchID }).toArray();
		const alreadySentSet = new Set(alreadySentDocs.map((d) => d.email));

		let successCount = 0;
		let failCount = 0;
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
				const info = await retry(() => sendEmail({
					to: email,
					subject,
					html: htmlTemplate,
					text: textTemplate,
				}), { retries: 3, baseDelayMs: 1000 });

				await alreadySentCollection.updateOne(
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

app.use((err, req, res, next) => {
	console.error("[unhandled]", err);
	return res.status(500).json({ ok: false, error: "Internal server error" });
});

app.listen(PORT, () => {
	console.log(`[server] listening on port ${PORT}`);
});
