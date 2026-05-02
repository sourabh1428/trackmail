"use strict";

jest.mock("@aws-sdk/client-ses");
jest.mock("nodemailer");
jest.mock("resend");

const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const nodemailer = require("nodemailer");
const { Resend } = require("resend");

process.env.EMAIL_USER = "ses@example.com";
process.env.EMAIL_USER2 = "gmail@example.com";
process.env.EMAIL_PASS2 = "pass";
process.env.resend_api_key = "re_test";
process.env.AWS_REGION = "ap-south-1";

const { sendViaConnectors, getISTDate } = require("../connectors");

const EMAIL_PARAMS = { to: "target@example.com", subject: "Hi", html: "<p>hello</p>" };

function makeDb({ configs = [], usage = [] } = {}) {
  const usageColl = {
    find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue(usage) })),
    updateOne: jest.fn().mockResolvedValue({}),
  };
  const configsColl = {
    find: jest.fn(() => ({
      sort: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue(configs) })),
    })),
  };
  return {
    collection: jest.fn(name => {
      if (name === "ConnectorConfigs") return configsColl;
      if (name === "ConnectorUsage") return usageColl;
    }),
  };
}

describe("getISTDate", () => {
  it("returns a YYYY-MM-DD string", () => {
    const date = getISTDate();
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("sendViaConnectors", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    SESClient.mockImplementation(() => ({
      send: jest.fn().mockResolvedValue({ MessageId: "ses-msg-id" }),
    }));
    SendEmailCommand.mockImplementation(params => params);

    nodemailer.createTransport.mockReturnValue({
      sendMail: jest.fn().mockResolvedValue({ messageId: "gmail-msg-id" }),
    });

    Resend.mockImplementation(() => ({
      emails: {
        send: jest.fn().mockResolvedValue({ data: { id: "resend-msg-id" }, error: null }),
      },
    }));
  });

  it("uses ses when ses has quota remaining", async () => {
    const db = makeDb({
      configs: [
        { name: "ses", dailyLimit: 200, enabled: true, order: 1 },
        { name: "gmail", dailyLimit: 100, enabled: true, order: 2 },
      ],
      usage: [{ name: "ses", istDate: getISTDate(), sent: 10 }],
    });

    const result = await sendViaConnectors(EMAIL_PARAMS, db);

    expect(result.connector).toBe("ses");
    expect(result.messageId).toBe("ses-msg-id");
    expect(db.collection("ConnectorUsage").updateOne).toHaveBeenCalledWith(
      { name: "ses", istDate: getISTDate() },
      { $inc: { sent: 1 } },
      { upsert: true }
    );
  });

  it("skips ses and uses gmail when ses is at its limit", async () => {
    const db = makeDb({
      configs: [
        { name: "ses", dailyLimit: 10, enabled: true, order: 1 },
        { name: "gmail", dailyLimit: 100, enabled: true, order: 2 },
      ],
      usage: [{ name: "ses", istDate: getISTDate(), sent: 10 }],
    });

    const result = await sendViaConnectors(EMAIL_PARAMS, db);

    expect(result.connector).toBe("gmail");
    expect(result.messageId).toBe("gmail-msg-id");
  });

  it("skips ses + gmail and uses resend when both are exhausted", async () => {
    const db = makeDb({
      configs: [
        { name: "ses", dailyLimit: 10, enabled: true, order: 1 },
        { name: "gmail", dailyLimit: 5, enabled: true, order: 2 },
        { name: "resend", dailyLimit: 100, enabled: true, order: 3 },
      ],
      usage: [
        { name: "ses", istDate: getISTDate(), sent: 10 },
        { name: "gmail", istDate: getISTDate(), sent: 5 },
      ],
    });

    const result = await sendViaConnectors(EMAIL_PARAMS, db);

    expect(result.connector).toBe("resend");
    expect(result.messageId).toBe("resend-msg-id");
  });

  it("throws when all connectors are quota-exhausted", async () => {
    const db = makeDb({
      configs: [
        { name: "ses", dailyLimit: 5, enabled: true, order: 1 },
        { name: "gmail", dailyLimit: 5, enabled: true, order: 2 },
      ],
      usage: [
        { name: "ses", istDate: getISTDate(), sent: 5 },
        { name: "gmail", istDate: getISTDate(), sent: 5 },
      ],
    });

    await expect(sendViaConnectors(EMAIL_PARAMS, db))
      .rejects.toThrow("All connectors exhausted for today");
  });

  it("falls back to next connector when current one throws a send error", async () => {
    SESClient.mockImplementation(() => ({
      send: jest.fn().mockRejectedValue(new Error("SES network error")),
    }));

    const db = makeDb({
      configs: [
        { name: "ses", dailyLimit: 200, enabled: true, order: 1 },
        { name: "gmail", dailyLimit: 100, enabled: true, order: 2 },
      ],
      usage: [],
    });

    const result = await sendViaConnectors(EMAIL_PARAMS, db);

    expect(result.connector).toBe("gmail");
  });

  it("skips connectors where enabled is false", async () => {
    const db = makeDb({
      configs: [
        { name: "ses", dailyLimit: 200, enabled: false, order: 1 },
        { name: "gmail", dailyLimit: 100, enabled: true, order: 2 },
      ],
      usage: [],
    });

    const result = await sendViaConnectors(EMAIL_PARAMS, db);

    expect(result.connector).toBe("gmail");
  });

  it("treats missing usage doc as sent=0 (new day)", async () => {
    const db = makeDb({
      configs: [{ name: "ses", dailyLimit: 200, enabled: true, order: 1 }],
      usage: [], // no usage doc yet
    });

    const result = await sendViaConnectors(EMAIL_PARAMS, db);

    expect(result.connector).toBe("ses");
  });

  it("throws last sender error when all connectors fail with send errors", async () => {
    SESClient.mockImplementation(() => ({
      send: jest.fn().mockRejectedValue(new Error("SES down")),
    }));
    nodemailer.createTransport.mockReturnValue({
      sendMail: jest.fn().mockRejectedValue(new Error("Gmail down")),
    });

    const db = makeDb({
      configs: [
        { name: "ses", dailyLimit: 200, enabled: true, order: 1 },
        { name: "gmail", dailyLimit: 100, enabled: true, order: 2 },
      ],
      usage: [],
    });

    await expect(sendViaConnectors(EMAIL_PARAMS, db))
      .rejects.toThrow("Gmail down");
  });
});
