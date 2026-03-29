"use strict";

const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "test-jwt-secret-32chars-minimum!!";

jest.mock("../db", () => ({ getDB: jest.fn() }));

const { getDB } = require("../db");
const statsRouter = require("../routes/stats");

const app = express();
app.use(express.json());
app.use("/", statsRouter);

function makeToken() {
  return jwt.sign({ sub: "dashboard" }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

describe("GET /api/bunches", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/bunches");
    expect(res.status).toBe(401);
  });

  it("returns list of bunches", async () => {
    const mockAggregate = jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        { bunch_id: "280326", sent: 42 },
        { bunch_id: "270326", sent: 38 },
      ]),
    });
    getDB.mockReturnValue({ collection: jest.fn(() => ({ aggregate: mockAggregate })) });

    const res = await request(app)
      .get("/api/bunches")
      .set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].bunch_id).toBe("280326");
  });
});

describe("GET /api/stats", () => {
  it("returns 400 without bunchId", async () => {
    getDB.mockReturnValue({});
    const res = await request(app)
      .get("/api/stats")
      .set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(400);
  });

  it("returns correct stats for a bunchId", async () => {
    const mockCollection = jest.fn((name) => {
      if (name === "AlreadySent") return { countDocuments: jest.fn().mockResolvedValue(50) };
      if (name === "TrackingEvents") return {
        aggregate: jest.fn().mockReturnValue({
          toArray: jest.fn()
            .mockResolvedValueOnce([
              { _id: "open", count: 10 },
              { _id: "click", count: 5 },
            ])
            .mockResolvedValueOnce([{ total: 2 }]),
        }),
      };
    });
    getDB.mockReturnValue({ collection: mockCollection });

    const res = await request(app)
      .get("/api/stats?bunchId=280326")
      .set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(50);
    expect(res.body.opens).toBe(10);
    expect(res.body.clicks).toBe(5);
    expect(res.body.openRate).toBe(20);
    expect(res.body.clickRate).toBe(10);
    expect(res.body.cameBack).toBe(2);
  });
});
