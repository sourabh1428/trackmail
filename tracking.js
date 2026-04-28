"use strict";

const TRACKING_BASE =
  process.env.TRACKING_WORKER_URL || "https://test-open.sppathak1428.workers.dev";

/**
 * Injects open-tracking pixel and click-tracking redirects into an HTML email.
 *
 * @param {string} html     - Raw email HTML.
 * @param {string} email    - Recipient email address (used as tracking identifier).
 * @param {string} bunchId  - Batch identifier in DDMMYY format; stored as bunch_id in D1.
 * @returns {string}        - HTML with tracking pixel and wrapped link hrefs.
 */
function addTracking(html, email, bunchId) {
  const enc = encodeURIComponent(email);
  const bid = encodeURIComponent(bunchId);
  const pixel = `<img src="${TRACKING_BASE}/track-open?email=${enc}&bid=${bid}" width="1" height="1" border="0" alt="" />`;

  let out = html.replace(/<a\s+(?:[^>]*?\s+)?href=(['"])(.*?)\1/gi, (match, q, url) => {
    if (url.includes("/track-link") || url.startsWith("#") || url.startsWith("mailto:")) return match;
    const tracked = `${TRACKING_BASE}/track-link?email=${enc}&bid=${bid}&url=${encodeURIComponent(url)}`;
    return `<a href=${q}${tracked}${q}`;
  });

  return out.includes("</body>")
    ? out.replace("</body>", `${pixel}</body>`)
    : out + pixel;
}

module.exports = { addTracking };
