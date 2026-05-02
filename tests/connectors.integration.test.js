"use strict";

/**
 * Integration tests for the multi-connector email module.
 * Uses real MongoDB (from MONGODB_URI) but mocks transport layers.
 * Run with: npx jest tests/connectors.integration.test.js --no-coverage --runInBand
 */

require("dotenv").config();

jest.mock("@aws-sdk/client-ses");
jest.mock("nodemailer");
jest.mock("resend");

const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const nodemailer = require("nodemailer");
const { Resend } = require("resend");
const { MongoClient } = require("mongodb");

const { sendViaConnectors, getISTDate } = require("../connectors");

const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME   = "Linkedin_scrape";
const TODAY     = getISTDate();

let mongoClient;
let db;

async function seedConfigs(configs) {
  await db.collection("ConnectorConfigs").deleteMany({});
  if (configs.length) await db.collection("ConnectorConfigs").insertMany(configs);
}

async function seedUsage(usageDocs) {
  await db.collection("ConnectorUsage").deleteMany({ istDate: TODAY });
  if (usageDocs.length) await db.collection("ConnectorUsage").insertMany(usageDocs);
}

async function getUsage(name) {
  return db.collection("ConnectorUsage").findOne({ name, istDate: TODAY });
}

beforeAll(async () => {
  mongoClient = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  await mongoClient.connect();
  db = mongoClient.db(DB_NAME);
});

afterAll(async () => {
  // Restore default connector configs so the live pipeline isn't broken after tests
  const defaults = [
    { name: "ses",    dailyLimit: 200, enabled: true, order: 1 },
    { name: "gmail",  dailyLimit: 100, enabled: true, order: 2 },
    { name: "resend", dailyLimit: 100, enabled: true, order: 3 },
  ];
  await db.collection("ConnectorConfigs").deleteMany({});
  await db.collection("ConnectorConfigs").insertMany(defaults);
  // Clean up today's test usage docs
  await db.collection("ConnectorUsage").deleteMany({ istDate: TODAY });
  await mongoClient.close();
});

beforeEach(async () => {
  jest.clearAllMocks();

  SESClient.mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({ MessageId: "ses-test-id" }),
  }));
  SendEmailCommand.mockImplementation(params => params);

  nodemailer.createTransport.mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: "gmail-test-id" }),
  });

  Resend.mockImplementation(() => ({
    emails: {
      send: jest.fn().mockResolvedValue({ data: { id: "resend-test-id" }, error: null }),
    },
  }));
});

const EMAIL = { to: "test@example.com", subject: "E2E Test", html: "<p>hi</p>" };

describe("sendViaConnectors with real MongoDB", () => {
  it("uses SES when it has quota (real DB read/write)", async () => {
    await seedConfigs([
      { name: "ses",   dailyLimit: 200, enabled: true, order: 1 },
      { name: "gmail", dailyLimit: 100, enabled: true, order: 2 },
    ]);
    await seedUsage([{ name: "ses", istDate: TODAY, sent: 5 }]);

    const result = await sendViaConnectors(EMAIL, db);

    expect(result.connector).toBe("ses");
    expect(result.messageId).toBe("ses-test-id");

    // Verify usage was incremented in real MongoDB
    const usage = await getUsage("ses");
    expect(usage.sent).toBe(6);
  });

  it("overflows to Gmail when SES is exhausted (real DB)", async () => {
    await seedConfigs([
      { name: "ses",   dailyLimit: 10,  enabled: true, order: 1 },
      { name: "gmail", dailyLimit: 100, enabled: true, order: 2 },
    ]);
    await seedUsage([{ name: "ses", istDate: TODAY, sent: 10 }]);

    const result = await sendViaConnectors(EMAIL, db);

    expect(result.connector).toBe("gmail");

    // Gmail usage created from 0 → 1
    const usage = await getUsage("gmail");
    expect(usage.sent).toBe(1);
  });

  it("overflows to Resend when SES + Gmail are exhausted (real DB)", async () => {
    await seedConfigs([
      { name: "ses",    dailyLimit: 5,   enabled: true, order: 1 },
      { name: "gmail",  dailyLimit: 5,   enabled: true, order: 2 },
      { name: "resend", dailyLimit: 100, enabled: true, order: 3 },
    ]);
    await seedUsage([
      { name: "ses",   istDate: TODAY, sent: 5 },
      { name: "gmail", istDate: TODAY, sent: 5 },
    ]);

    const result = await sendViaConnectors(EMAIL, db);

    expect(result.connector).toBe("resend");
    const usage = await getUsage("resend");
    expect(usage.sent).toBe(1);
  });

  it("throws when all connectors exhausted (real DB)", async () => {
    await seedConfigs([
      { name: "ses",   dailyLimit: 5, enabled: true, order: 1 },
      { name: "gmail", dailyLimit: 5, enabled: true, order: 2 },
    ]);
    await seedUsage([
      { name: "ses",   istDate: TODAY, sent: 5 },
      { name: "gmail", istDate: TODAY, sent: 5 },
    ]);

    await expect(sendViaConnectors(EMAIL, db))
      .rejects.toThrow("All connectors exhausted for today");
  });

  it("upserts usage from zero on a fresh day (no existing doc)", async () => {
    await seedConfigs([{ name: "ses", dailyLimit: 200, enabled: true, order: 1 }]);
    await seedUsage([]); // no usage doc

    const result = await sendViaConnectors(EMAIL, db);

    expect(result.connector).toBe("ses");
    const usage = await getUsage("ses");
    expect(usage.sent).toBe(1);
  });

  it("falls back to Gmail when SES send throws (real DB fallback)", async () => {
    SESClient.mockImplementation(() => ({
      send: jest.fn().mockRejectedValue(new Error("SES connection refused")),
    }));
    await seedConfigs([
      { name: "ses",   dailyLimit: 200, enabled: true, order: 1 },
      { name: "gmail", dailyLimit: 100, enabled: true, order: 2 },
    ]);
    await seedUsage([]);

    const result = await sendViaConnectors(EMAIL, db);

    expect(result.connector).toBe("gmail");
    // SES usage should NOT have been incremented (send failed before $inc)
    const sesUsage = await getUsage("ses");
    expect(sesUsage).toBeNull();
  });

  it("skips disabled connectors (real DB)", async () => {
    await seedConfigs([
      { name: "ses",   dailyLimit: 200, enabled: false, order: 1 },
      { name: "gmail", dailyLimit: 100, enabled: true,  order: 2 },
    ]);
    await seedUsage([]);

    const result = await sendViaConnectors(EMAIL, db);

    expect(result.connector).toBe("gmail");
  });
});

describe("ConnectorConfigs seeding via direct MongoDB", () => {
  it("PUT-equivalent: upserts all three connectors correctly", async () => {
    await db.collection("ConnectorConfigs").deleteMany({});

    const connectors = [
      { name: "ses",    dailyLimit: 200, enabled: true, order: 1 },
      { name: "gmail",  dailyLimit: 100, enabled: true, order: 2 },
      { name: "resend", dailyLimit: 100, enabled: true, order: 3 },
    ];
    for (const c of connectors) {
      await db.collection("ConnectorConfigs").updateOne(
        { name: c.name },
        { $set: { dailyLimit: c.dailyLimit }, $setOnInsert: { enabled: c.enabled, order: c.order } },
        { upsert: true }
      );
    }

    const docs = await db.collection("ConnectorConfigs").find({}).sort({ order: 1 }).toArray();
    expect(docs).toHaveLength(3);
    expect(docs[0].name).toBe("ses");
    expect(docs[0].dailyLimit).toBe(200);
    expect(docs[1].name).toBe("gmail");
    expect(docs[2].name).toBe("resend");
  });
});
