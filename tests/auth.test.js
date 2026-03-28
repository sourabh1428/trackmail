"use strict";

const request = require("supertest");
const express = require("express");

process.env.JWT_SECRET = "test-jwt-secret-32chars-minimum!!";
process.env.DASHBOARD_PASSWORD = "correct-horse-battery";

const authRouter = require("../routes/auth");

const app = express();
app.use(express.json());
app.use("/auth", authRouter);

describe("POST /auth/login", () => {
  it("returns a JWT token on correct password", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ password: "correct-horse-battery" });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.token.split(".").length).toBe(3);
  });

  it("returns 401 on wrong password", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it("returns 401 on missing password", async () => {
    const res = await request(app).post("/auth/login").send({});
    expect(res.status).toBe(401);
  });
});
