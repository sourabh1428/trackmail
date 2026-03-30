import { WorkflowEntrypoint } from "cloudflare:workers";

const OPEN_TRACKING_WEBHOOK =
  "https://discord.com/api/webhooks/1314893421055311883/1BXveYCt1kepEEphLsnyNtR7Kov5Zha-XdQVhN70XAfUQtggmD0qVFGQM5axZsyJ4xMa";
const LINK_TRACKING_WEBHOOK =
  "https://discord.com/api/webhooks/1314896649839185920/AHfVtNS1yvWFSIFBlAAZGmiTr_x5Ck15_ai-ECtQM0Qt_ZC2-eF5iiITBWURqgXFNIQr";

// ── Cloudflare Workflow ───────────────────────────────────────────────────────
// Durable D1 insert: retries automatically on failure so no tracking event
// is silently dropped due to a transient D1 error.
export class TrackingWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const { email, eventType, bunch_id, url, ip, timestamp } = event.payload;

    await step.do("insert tracking event into D1", async () => {
      await this.env.DB.prepare(
        `INSERT INTO tracking_events (email, event, bunch_id, url, ip, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(email, eventType, bunch_id ?? null, url ?? null, ip ?? null, timestamp)
        .run();
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function postToDiscord(webhookUrl, embedMessage) {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embedMessage] }),
    });
    if (!response.ok) {
      throw new Error(`Failed to send to Discord: ${response.statusText}`);
    }
  } catch (error) {
    console.error("Discord notification error:", error);
  }
}

function getClientIP(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "Unknown"
  );
}

function getBrowserInfo(userAgent) {
  if (!userAgent) return "Unknown";

  let browser = "Unknown";
  if (userAgent.includes("Chrome")) browser = "Chrome";
  else if (userAgent.includes("Firefox")) browser = "Firefox";
  else if (userAgent.includes("Safari")) browser = "Safari";
  else if (userAgent.includes("Edge")) browser = "Edge";
  else if (userAgent.includes("MSIE") || userAgent.includes("Trident/"))
    browser = "Internet Explorer";

  let device = "Desktop";
  if (userAgent.includes("Mobile")) device = "Mobile";
  else if (userAgent.includes("Tablet")) device = "Tablet";

  return `${browser} on ${device}`;
}

function istNow() {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());
}

// ── Tracking pixel (1×1 transparent GIF) ─────────────────────────────────────
const PIXEL = new Uint8Array([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33,
  249, 4, 1, 0, 0, 1, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── Worker ────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    try {
      const reqUrl = new URL(request.url);
      const email = reqUrl.searchParams.get("email") || "";
      const bid = reqUrl.searchParams.get("bid") || null;      // bunch_id from email send (optional)
      const userAgent = request.headers.get("User-Agent") || "Unknown";
      const clientIP = getClientIP(request);
      const browserInfo = getBrowserInfo(userAgent);
      const timestamp = new Date().toISOString();

      // ── /track-open ─────────────────────────────────────────────────────────
      if (reqUrl.pathname === "/track-open") {
        if (!email) return new Response("Missing email", { status: 400 });

        const embedMessage = {
          title: "📧 Email Opened",
          description: `**${email}** has opened the email.`,
          color: 3066993,
          fields: [
            { name: "Timestamp", value: istNow(), inline: true },
            { name: "Device",    value: browserInfo, inline: true },
            { name: "IP Address", value: clientIP,   inline: true },
          ],
          footer: { text: "Email Tracking Service" },
          timestamp,
        };

        // Fire-and-forget: Discord notification + durable D1 workflow
        ctx.waitUntil(
          Promise.all([
            postToDiscord(OPEN_TRACKING_WEBHOOK, embedMessage),
            env.TRACKING_WORKFLOW.create({
              params: { email, eventType: "open", bunch_id: bid, ip: clientIP, timestamp },
            }),
          ])
        );

        return new Response(PIXEL, {
          headers: {
            "Content-Type": "image/gif",
            "Cache-Control": "no-store, no-cache, must-revalidate",
            Pragma: "no-cache",
            Expires: "0",
            ...CORS,
          },
        });
      }

      // ── /track-link ─────────────────────────────────────────────────────────
      if (reqUrl.pathname === "/track-link") {
        const link = reqUrl.searchParams.get("url");
        if (!email || !link)
          return new Response("Missing parameters", { status: 400 });

        const decodedLink = decodeURIComponent(link);
        if (!/^https?:\/\//i.test(decodedLink))
          return new Response("Invalid URL", { status: 400 });

        const embedMessage = {
          title: "🔗 Link Clicked",
          description: `**${email}** clicked on a link.`,
          color: 16711680,
          fields: [
            {
              name: "Clicked Link",
              value:
                decodedLink.length > 100
                  ? decodedLink.substring(0, 97) + "..."
                  : decodedLink,
              inline: false,
            },
            { name: "Timestamp",  value: istNow(),     inline: true },
            { name: "Device",     value: browserInfo,  inline: true },
            { name: "IP Address", value: clientIP,     inline: true },
          ],
          footer: { text: "Link Tracking Service" },
          timestamp,
        };

        // Fire-and-forget: Discord notification + durable D1 workflow
        ctx.waitUntil(
          Promise.all([
            postToDiscord(LINK_TRACKING_WEBHOOK, embedMessage),
            env.TRACKING_WORKFLOW.create({
              params: { email, eventType: "click", bunch_id: bid, url: decodedLink, ip: clientIP, timestamp },
            }),
          ])
        );

        return Response.redirect(decodedLink, 302);
      }

      // ── /d1/stats ────────────────────────────────────────────────────────────
      if (reqUrl.pathname === "/d1/stats") {
        const secret = request.headers.get("x-track-secret");
        if (!secret || secret !== env.TRACK_SECRET) {
          return new Response("Unauthorized", { status: 401, headers: CORS });
        }

        const bunchId = reqUrl.searchParams.get("bunch_id");
        if (!bunchId) {
          return new Response(JSON.stringify({ error: "bunch_id query param required" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }

        // Distinct openers (each email counted once even if pixel loaded multiple times)
        const opensResult = await env.DB.prepare(
          `SELECT COUNT(DISTINCT email) AS opens FROM tracking_events WHERE bunch_id = ? AND event = 'open'`
        ).bind(bunchId).first();

        // Distinct clickers
        const clicksResult = await env.DB.prepare(
          `SELECT COUNT(DISTINCT email) AS clicks FROM tracking_events WHERE bunch_id = ? AND event = 'click'`
        ).bind(bunchId).first();

        // "Came back" = clicked more than once (distinct emails with click count > 1)
        const cameBackResult = await env.DB.prepare(
          `SELECT COUNT(*) AS came_back FROM (
             SELECT email FROM tracking_events WHERE bunch_id = ? AND event = 'click'
             GROUP BY email HAVING COUNT(*) > 1
           )`
        ).bind(bunchId).first();

        return new Response(
          JSON.stringify({
            opens: opensResult?.opens ?? 0,
            clicks: clicksResult?.clicks ?? 0,
            cameBack: cameBackResult?.came_back ?? 0,
          }),
          { headers: { "Content-Type": "application/json", ...CORS } }
        );
      }

      // ── /d1/events ───────────────────────────────────────────────────────────
      if (reqUrl.pathname === "/d1/events") {
        const secret = request.headers.get("x-track-secret");
        if (!secret || secret !== env.TRACK_SECRET) {
          return new Response("Unauthorized", { status: 401, headers: CORS });
        }

        const bunchId = reqUrl.searchParams.get("bunch_id");
        if (!bunchId) {
          return new Response(JSON.stringify({ error: "bunch_id query param required" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }

        const { results } = await env.DB.prepare(
          `SELECT email, event, timestamp, url FROM tracking_events WHERE bunch_id = ? ORDER BY timestamp ASC`
        ).bind(bunchId).all();

        return new Response(JSON.stringify(results ?? []), {
          headers: { "Content-Type": "application/json", ...CORS },
        });
      }

      return new Response("Not Found", { status: 404, headers: CORS });
    } catch (error) {
      console.error("Tracking Worker Error:", error);
      return new Response("Internal Server Error", { status: 500, headers: CORS });
    }
  },
};
