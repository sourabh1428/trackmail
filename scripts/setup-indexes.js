"use strict";

require("dotenv").config();
const { MongoClient } = require("mongodb");

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  const db = client.db("Linkedin_scrape");

  // TrackingEvents: fast lookup by email+event and by bunch_id
  await db.collection("TrackingEvents").createIndex(
    { email: 1, event: 1 },
    { background: true }
  );
  console.log("✅ TrackingEvents index: { email, event }");

  await db.collection("TrackingEvents").createIndex(
    { bunch_id: 1 },
    { background: true }
  );
  console.log("✅ TrackingEvents index: { bunch_id }");

  // EmailTemplates: unique partial index ensures only one active template
  await db.collection("EmailTemplates").createIndex(
    { isActive: 1 },
    {
      unique: true,
      partialFilterExpression: { isActive: true },
      background: true,
    }
  );
  console.log("✅ EmailTemplates index: { isActive } (unique partial)");

  // AlreadySent: unique on email (already created by send-daily-emails.js but idempotent)
  await db.collection("AlreadySent").createIndex(
    { email: 1 },
    { unique: true, background: true }
  );
  console.log("✅ AlreadySent index: { email } (unique)");

  await client.close();
  console.log("\n✅ All indexes created successfully.");
}

main().catch(e => { console.error(e); process.exit(1); });
