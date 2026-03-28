"use strict";

const request = require("supertest");
const express = require("express");

process.env.TRACK_SECRET = "track-secret-test-value";

jest.mock("../db", () => ({
  getDB: jest.fn(() => ({
    collection: jest.fn(() => ({
      insertOne: jest.fn().mockResolvedValue({ insertedId: "abc123" }),
    })),
  })),
}));

const trackingRouter = require("../routes/tracking");

const app = express();
app.use(express.json());
app.use("/", trackingRouter);

describe("POST /track-event", () => {
  it("returns 403 without track secret header", async () => {
    const res = await request(app)
      .post("/track-event")
      .send({ email: "a@b.com", event: "open", bunch_id: "280326" });
    expect(res.status).toBe(403);
  });

  it("accepts a valid open event", async () => {
    const res = await request(app)
      .post("/track-event")
      .set("x-track-secret", "track-secret-test-value")
      .send({ email: "a@b.com", event: "open", bunch_id: "280326" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("accepts a valid click event with url", async () => {
    const res = await request(app)
      .post("/track-event")
      .set("x-track-secret", "track-secret-test-value")
      .send({ email: "a@b.com", event: "click", bunch_id: "280326", url: "https://example.com" });
    expect(res.status).toBe(200);
  });

  it("returns 400 on invalid event type", async () => {
    const res = await request(app)
      .post("/track-event")
      .set("x-track-secret", "track-secret-test-value")
      .send({ email: "a@b.com", event: "bogus", bunch_id: "280326" });
    expect(res.status).toBe(400);
  });

  it("returns 400 on missing required fields", async () => {
    const res = await request(app)
      .post("/track-event")
      .set("x-track-secret", "track-secret-test-value")
      .send({ email: "a@b.com" });
    expect(res.status).toBe(400);
  });
});
