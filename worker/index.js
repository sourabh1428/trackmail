/**
 * Cloudflare Worker — email tracking pixel + link redirector
 *
 * Routes:
 *   GET /track-open?email=<e>&bid=<b>        → 1x1 GIF + async POST to Express
 *   GET /track-link?email=<e>&bid=<b>&url=<u> → 302 redirect + async POST to Express
 *
 * Worker env vars (set via wrangler secret):
 *   EXPRESS_API_URL  — e.g. https://your-api.railway.app
 *   TRACK_SECRET     — shared secret matching server TRACK_SECRET
 */

const PIXEL = new Uint8Array([
  0x47,0x49,0x46,0x38,0x39,0x61,0x01,0x00,0x01,0x00,0x80,0x00,0x00,
  0xff,0xff,0xff,0x00,0x00,0x00,0x21,0xf9,0x04,0x00,0x00,0x00,0x00,
  0x00,0x2c,0x00,0x00,0x00,0x00,0x01,0x00,0x01,0x00,0x00,0x02,0x02,
  0x44,0x01,0x00,0x3b,
]);

async function writeToD1(env, { email, event, bunch_id, url, ip }) {
  try {
    await env.DB.prepare(
      `INSERT INTO tracking_events (email, event, bunch_id, url, ip, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(email, event, bunch_id, url ?? null, ip ?? null, new Date().toISOString())
      .run();
  } catch {
    /* silently drop — tracking loss acceptable */
  }
}

async function postEvent(env, body) {
  const url = `${env.EXPRESS_API_URL}/track-event`;
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-track-secret": env.TRACK_SECRET,
    },
    body: JSON.stringify(body),
  };
  try {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    // Retry once — tracking loss is acceptable, broken links are not
    try { await fetch(url, options); } catch { /* silently drop */ }
  }
}

export default {
  async fetch(request, env, ctx) {
    const { pathname, searchParams } = new URL(request.url);
    const email = searchParams.get("email") || "";
    const bid = searchParams.get("bid") || "";

    const ip = request.headers.get("CF-Connecting-IP") || "";

    if (pathname === "/track-open") {
      const payload = { email, event: "open", bunch_id: bid, ip };
      ctx.waitUntil(Promise.all([
        writeToD1(env, payload),
        postEvent(env, payload),
      ]));
      return new Response(PIXEL, {
        status: 200,
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Pragma": "no-cache",
        },
      });
    }

    if (pathname === "/track-link") {
      const targetUrl = searchParams.get("url") || "/";
      const payload = { email, event: "click", bunch_id: bid, url: targetUrl, ip };
      ctx.waitUntil(Promise.all([
        writeToD1(env, payload),
        postEvent(env, payload),
      ]));
      return Response.redirect(targetUrl, 302);
    }

    return new Response("Not found", { status: 404 });
  },
};
