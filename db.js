"use strict";

const { MongoClient } = require("mongodb");

let client;
let db;

async function connectDB() {
  if (db) return db;
  client = new MongoClient(process.env.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 20000,
  });
  await client.connect();
  db = client.db("Linkedin_scrape");

  // Ensure indexes on startup
  await db.collection("AlreadySent").createIndex({ email: 1 }, { unique: true }).catch(() => {});
  await db.collection("TrackingEvents").createIndex({ email: 1, event: 1 }).catch(() => {});
  await db.collection("TrackingEvents").createIndex({ bunch_id: 1 }).catch(() => {});

  console.log("[db] connected to MongoDB");
  return db;
}

function getDB() {
  if (!db) throw new Error("Database not connected. Call connectDB() first.");
  return db;
}

async function closeDB() {
  if (client) {
    await client.close();
    db = null;
    client = null;
    console.log("[db] connection closed");
  }
}

module.exports = { connectDB, getDB, closeDB };
