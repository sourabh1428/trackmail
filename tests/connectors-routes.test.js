"use strict";

const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "test-jwt-secret-32chars-minimum!!";

jest.mock("../db", () => ({ getDB: jest.fn() }));
const { getDB } = require("../db");
const connectorsRouter = require("../routes/connectors");

const app = express();
app.use(express.json());
app.use("/api/connectors", connectorsRouter);

function makeToken() {
  return jwt.sign({ sub: "dashboard" }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

describe("GET /api/connectors", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/connectors");
    expect(res.status).toBe(401);
  });

  it("returns configs joined with today's usage", async () => {
    const mockConfigs = [
      { name: "ses",    dailyLimit: 200, enabled: true, order: 1 },
      { name: "gmail",  dailyLimit: 100, enabled: true, order: 2 },
      { name: "resend", dailyLimit: 100, enabled: true, order: 3 },
    ];
    const mockUsage = [
      { name: "ses", istDate: todayIST(), sent: 47 },
    ];

    getDB.mockReturnValue({
      collection: jest.fn().mockImplementation(name => {
        if (name === "ConnectorConfigs") {
          return {
            find: jest.fn(() => ({
              sort: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue(mockConfigs) })),
            })),
          };
        }
        return {
          find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue(mockUsage) })),
        };
      }),
    });

    const res = await request(app)
      .get("/api/connectors")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);

    const ses = res.body.find(c => c.name === "ses");
    expect(ses.sentToday).toBe(47);
    expect(ses.remaining).toBe(153);

    const gmail = res.body.find(c => c.name === "gmail");
    expect(gmail.sentToday).toBe(0);
    expect(gmail.remaining).toBe(100);
  });
});

describe("PUT /api/connectors/limits", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).put("/api/connectors/limits").send({ ses: 200 });
    expect(res.status).toBe(401);
  });

  it("updates all three connector limits", async () => {
    const updateOne = jest.fn().mockResolvedValue({});
    getDB.mockReturnValue({ collection: jest.fn(() => ({ updateOne })) });

    const res = await request(app)
      .put("/api/connectors/limits")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ ses: 200, gmail: 100, resend: 50 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.updated).toEqual(expect.arrayContaining(["ses", "gmail", "resend"]));
    expect(updateOne).toHaveBeenCalledTimes(3);
  });

  it("updates only specified connectors (partial update)", async () => {
    const updateOne = jest.fn().mockResolvedValue({});
    getDB.mockReturnValue({ collection: jest.fn(() => ({ updateOne })) });

    const res = await request(app)
      .put("/api/connectors/limits")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ resend: 75 });

    expect(res.status).toBe(200);
    expect(res.body.updated).toEqual(["resend"]);
    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  it("rejects non-positive-integer limits", async () => {
    const res = await request(app)
      .put("/api/connectors/limits")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ ses: -5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive integer/i);
  });

  it("rejects float limits", async () => {
    const res = await request(app)
      .put("/api/connectors/limits")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ ses: 10.5 });

    expect(res.status).toBe(400);
  });

  it("rejects unknown connector names", async () => {
    const res = await request(app)
      .put("/api/connectors/limits")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ mailgun: 100 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown/i);
  });

  it("rejects empty body", async () => {
    const res = await request(app)
      .put("/api/connectors/limits")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({});

    expect(res.status).toBe(400);
  });
});
