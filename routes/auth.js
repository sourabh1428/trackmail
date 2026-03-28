"use strict";

const router = require("express").Router();
const jwt = require("jsonwebtoken");

router.post("/login", (req, res) => {
  const { password } = req.body || {};
  if (!password || password !== process.env.DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: "Invalid password" });
  }
  const token = jwt.sign(
    { sub: "dashboard" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
  return res.json({ token });
});

module.exports = router;
