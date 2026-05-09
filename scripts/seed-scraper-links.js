"use strict";

require("dotenv").config();

const { connectDB, getDB, closeDB } = require("../db");

const LINKS = [
  { url: "https://www.linkedin.com/search/results/content/?keywords=hiring%20software%20engineer&origin=GLOBAL_SEARCH_HEADER&sortBy=%22date_posted%22", label: "Hiring software engineer" },
  { url: "https://www.linkedin.com/search/results/content/?keywords=reactjs%20hiring&origin=SWITCH_SEARCH_VERTICAL&sid=5Lz", label: "ReactJS hiring" },
  { url: "https://www.linkedin.com/search/results/content/?keywords=hiring+software+engineer&origin=FACETED_SEARCH", label: "Hiring software engineer (faceted)" },
  { url: "https://www.linkedin.com/search/results/content/?keywords=reactjs%20hiring&origin=FACETED_SEARCH&sortBy=%5B%22date_posted%22%5D", label: "ReactJS hiring (by date)" },
  { url: "https://www.linkedin.com/search/results/content/?keywords=reactjs%20hiring&origin=FACETED_SEARCH&sortBy=%5B%22relevance%22%5D", label: "ReactJS hiring (by relevance)" },
];

async function main() {
  await connectDB();
  const db = getDB();
  let upserted = 0;
  for (const link of LINKS) {
    const result = await db.collection("ScraperLinks").updateOne(
      { url: link.url },
      { $setOnInsert: { ...link, enabled: true, createdAt: new Date(), updatedAt: new Date() } },
      { upsert: true }
    );
    if (result.upsertedCount) upserted++;
  }
  console.log(`[seed] Seeded ${upserted} new links (${LINKS.length - upserted} already existed)`);
  await closeDB();
}

main().catch(e => { console.error(e.message); process.exit(1); });
