"use strict";

const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");

process.env.JWT_SECRET = "test-jwt-secret-32chars-minimum!!";

jest.mock("../db", () => ({ getDB: jest.fn() }));
const { getDB } = require("../db");
const templatesRouter = require("../routes/templates");

const app = express();
app.use(express.json());
app.use("/api", templatesRouter);

function makeToken() {
  return jwt.sign({ sub: "dashboard" }, process.env.JWT_SECRET, { expiresIn: "1h" });
}
const fakeId = new ObjectId().toHexString();

describe("GET /api/templates", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/templates");
    expect(res.status).toBe(401);
  });

  it("returns template list without html field", async () => {
    const mockFind = {
      project: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([{ _id: fakeId, name: "t1", isActive: false }]),
    };
    getDB.mockReturnValue({ collection: jest.fn(() => ({ find: jest.fn(() => mockFind) })) });
    const res = await request(app).get("/api/templates").set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].html).toBeUndefined();
  });
});

describe("GET /api/templates/active", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/templates/active");
    expect(res.status).toBe(401);
  });

  it("returns 404 when no active template", async () => {
    getDB.mockReturnValue({ collection: jest.fn(() => ({ findOne: jest.fn().mockResolvedValue(null) })) });
    const res = await request(app).get("/api/templates/active").set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(404);
  });

  it("returns active template with html", async () => {
    getDB.mockReturnValue({
      collection: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue({ _id: fakeId, name: "t1", isActive: true, html: "<p>hi</p>" }),
      })),
    });
    const res = await request(app).get("/api/templates/active").set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.html).toBe("<p>hi</p>");
  });
});

describe("POST /api/templates", () => {
  it("returns 400 when name missing", async () => {
    const res = await request(app).post("/api/templates").set("Authorization", `Bearer ${makeToken()}`).send({ html: "<p>hi</p>" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when html missing", async () => {
    const res = await request(app).post("/api/templates").set("Authorization", `Bearer ${makeToken()}`).send({ name: "T" });
    expect(res.status).toBe(400);
  });

  it("creates a template with isActive: false", async () => {
    getDB.mockReturnValue({ collection: jest.fn(() => ({ insertOne: jest.fn().mockResolvedValue({ insertedId: fakeId }) })) });
    const res = await request(app).post("/api/templates").set("Authorization", `Bearer ${makeToken()}`).send({ name: "Test", html: "<p>hi</p>" });
    expect(res.status).toBe(201);
    expect(res.body.isActive).toBe(false);
    expect(res.body.name).toBe("Test");
    expect(res.body.createdAt).toBeTruthy();
  });
});

describe("PUT /api/templates/:id", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).put(`/api/templates/${fakeId}`).send({ name: "New Name" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when neither name nor html provided", async () => {
    const res = await request(app).put(`/api/templates/${fakeId}`).set("Authorization", `Bearer ${makeToken()}`).send({});
    expect(res.status).toBe(400);
  });

  it("returns 200 {ok:true} on successful update", async () => {
    getDB.mockReturnValue({
      collection: jest.fn(() => ({
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
      })),
    });
    const res = await request(app).put(`/api/templates/${fakeId}`).set("Authorization", `Bearer ${makeToken()}`).send({ name: "Updated Name" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 404 when template not found (matchedCount=0)", async () => {
    getDB.mockReturnValue({
      collection: jest.fn(() => ({
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 0 }),
      })),
    });
    const res = await request(app).put(`/api/templates/${fakeId}`).set("Authorization", `Bearer ${makeToken()}`).send({ name: "Updated Name" });
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid id", async () => {
    const res = await request(app).put("/api/templates/not-an-id").set("Authorization", `Bearer ${makeToken()}`).send({ name: "x" });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/templates/:id", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).delete(`/api/templates/${fakeId}`);
    expect(res.status).toBe(401);
  });

  it("rejects deletion of active template", async () => {
    getDB.mockReturnValue({
      collection: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue({ _id: fakeId, isActive: true }),
      })),
    });
    const res = await request(app).delete(`/api/templates/${fakeId}`).set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/active/i);
  });

  it("deletes an inactive template", async () => {
    getDB.mockReturnValue({
      collection: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue({ _id: fakeId, isActive: false }),
        deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      })),
    });
    const res = await request(app).delete(`/api/templates/${fakeId}`).set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 400 for invalid id", async () => {
    const res = await request(app).delete("/api/templates/not-an-id").set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/templates/:id/activate", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).post(`/api/templates/${fakeId}/activate`);
    expect(res.status).toBe(401);
  });

  it("activates a template via bulkWrite with deactivate-all first, then activate target", async () => {
    const bulkWrite = jest.fn().mockResolvedValue({});
    const findOne = jest.fn().mockResolvedValue({ _id: fakeId });
    getDB.mockReturnValue({ collection: jest.fn(() => ({ findOne, bulkWrite })) });
    const res = await request(app).post(`/api/templates/${fakeId}/activate`).set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const [ops] = bulkWrite.mock.calls;
    expect(ops[0][0]).toHaveProperty("updateMany");
    expect(ops[0][1]).toHaveProperty("updateOne");
  });

  it("returns 404 when template not found", async () => {
    getDB.mockReturnValue({ collection: jest.fn(() => ({
      findOne: jest.fn().mockResolvedValue(null),
      bulkWrite: jest.fn(),
    })) });
    const res = await request(app).post(`/api/templates/${fakeId}/activate`).set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid id", async () => {
    const res = await request(app).post("/api/templates/not-an-id/activate").set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(400);
  });
});
