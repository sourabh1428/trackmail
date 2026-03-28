"use strict";

function verifyTrackSecret(req, res, next) {
  const secret = req.headers["x-track-secret"];
  if (!secret || secret !== process.env.TRACK_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

module.exports = { verifyTrackSecret };
