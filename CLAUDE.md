# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Scraper (Python)
cd scraper && python main.py                     # headless (default)
cd scraper && HEADLESS_MODE=false python main.py # headed browser for debugging

# Evaluator (Node.js) — run after scrape, before send
node evaluate-eligibility.js                     # score today's scraped docs via Gemini
EVAL_DRY_RUN=true node evaluate-eligibility.js  # log verdicts without writing to MongoDB
BUNCH_ID=280326 node evaluate-eligibility.js     # evaluate a specific day's batch

# Sender (Node.js) — run after evaluate
node send-daily-emails.js                        # send today's evaluated batch (score >= 0.7)
DRY_RUN=true node send-daily-emails.js           # preview without sending
BUNCH_ID=280326 node send-daily-emails.js        # re-send a specific day's batch

# Express API server
node server.js          # or: npm start
npm run dev             # nodemon with auto-reload

# Docker
docker build -t trackmail . && docker run --env-file .env trackmail
```

**Required env vars:** `MONGODB_URI`, `EMAIL_USER` (SES verified sender), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `LINKEDIN_EMAIL`, `LINKEDIN_PASSWORD`, `GROQ_API_KEY`

## Architecture

Three-stage pipeline sharing a MongoDB database (`Linkedin_scrape`): **scrape → evaluate → send**

**Python scraper (`scraper/`)**
- `main.py` — entry point; reads `LINKEDIN_LINKS` from `config/linkedin_links.py`, launches Playwright browser, calls `LinkedInScraper.scrape_multiple_links()`
- `scraper.py` — `LinkedInScraper` class; uses round-robin tab scrolling (single browser context, multiple tabs) to collect emails; saves session to `linkedin_context.json` to avoid re-login within 24 hours
- `pages/search_page.py` — `LinkedInSearchPage` writes each extracted email directly to MongoDB (`Emails` collection) with `bunch_id` (DDMMYY format), `post_text` (scraped hiring post body text), and `status: "scraped"`
  - `extract_post_text_for_email(email)` — tries known LinkedIn post selectors (`div.feed-shared-update-v2`, `li.reusable-search__result-container`, etc.) then falls back to a 2000-char window around the email in the full page body
- `config/settings.py` — all scroll timing, parallel worker count, and stop-condition thresholds
- To add new LinkedIn search URLs: edit `config/linkedin_links.py` or run `python add_links.py`

**LLM eligibility evaluator (`evaluate-eligibility.js`)**
- Reads `Emails` docs where `{ bunch_id, status: "scraped" }` for today (or `BUNCH_ID` env override)
- Calls Gemini 2.5 Flash-Lite (`gemini-2.5-flash-lite-preview-06-17`) with structured JSON output (`responseSchema`) for each doc
- Profile context: hardcoded constant — Frontend/Full-stack Engineer, ~2yr exp, React/TS/Node/Postgres, Bangalore, open to remote/hybrid in India
- Skip rules encoded in prompt: 5+ YOE required, non-frontend roles (backend-only/DevOps/ML/data), on-site outside India, generic recruiter spam
- Output schema: `{ score: float 0–1, verdict: "send"|"skip", reasoning: string, matched_keywords: string[], personalization_hook: string }`
- Rate limiting: 15 RPM (4-second minimum interval between calls); exponential backoff on 429s; 3 retries
- Writes `evaluation` object and sets `status: "evaluated"` for each processed doc
- Docs missing `post_text` are auto-skipped with `score: 0, verdict: "skip"`
- `EVAL_DRY_RUN=true` — logs verdicts without writing to MongoDB

**Node.js mailer (`send-daily-emails.js`)**
- Reads `Emails` docs where `{ bunch_id, status: "evaluated", "evaluation.score": { $gte: 0.7 } }`, sorted by score desc
- Skips emails already in `AlreadySent` or `Unsubscribed` collections; sets `status: "skipped"` on those docs
- Substitutes `{{PersonalizationHook}}` in the HTML template with the LLM-generated opener (wrapped in `<p>` if non-empty)
- Injects open-tracking pixel and click-tracking redirects via `addTracking()` from `tracking.js`
- Sends via AWS SES (`SendEmailCommand`); retries up to 3× with exponential backoff (skips retry on 4xx except 429)
- On successful send: inserts into `AlreadySent`, sets `status: "sent"` on the Emails doc
- `DRY_RUN=true` — previews recipients and hook text without sending or writing to MongoDB

**Express API (`server.js` + `mailer.js`)**
- `mailer.js` — SES client wrapper, exported as `{ sendEmail }`
- `server.js` — three routes: `GET /health`, `POST /send-email` (single), `POST /send-bulk-emails` (batch by `bunchID`)
- Both routes support `{{variable}}` template substitution via `variables` / `defaultVariables` in the request body
- `AlreadySent` dedup logic in `/send-bulk-emails` uses `bunch_id + email` upsert (not the unique-index approach used by the CLI script)

**New API routes (server.js):**
- `POST /auth/login` — public; accepts `{ password }`; returns JWT (7d)
- `POST /track-event` — public; `x-track-secret` header; writes to `TrackingEvents`
- `GET /api/bunches` — JWT; list bunches with sent count
- `GET /api/stats?bunchId=X` — JWT; `{ sent, opens, clicks, cameBack, openRate, clickRate }`
- `GET /api/events?bunchId=X` — JWT; per-recipient rows
- `GET /api/templates` — JWT; list templates (no html)
- `GET /api/templates/active` — JWT; active template with html
- `POST /api/templates` — JWT; create `{ name, html }`
- `PUT /api/templates/:id` — JWT; update name/html; 400 for invalid ObjectId
- `DELETE /api/templates/:id` — JWT; rejects if isActive
- `POST /api/templates/:id/activate` — JWT; bulkWrite activate
- `GET /api/connectors` — JWT; list connectors with today's usage and remaining quota
- `PUT /api/connectors/limits` — JWT; set daily limits for one or more connectors in one call
- `POST /send-email` — JWT-protected
- `POST /send-bulk-emails` — JWT-protected

**Multi-connector email sending (`connectors.js`):**
- Three connectors in order: `ses` (order 1) → `gmail` (order 2) → `resend` (order 3)
- Sequential overflow: SES fills to its daily limit first, then Gmail, then Resend
- `sendViaConnectors({ to, subject, html, text, replyTo }, db)` — exported from `connectors.js`; called by `send-daily-emails.js`
- Daily limits stored in `ConnectorConfigs` collection; usage counters in `ConnectorUsage` (reset via IST date rollover at 12:00 AM IST)
- Set limits via: `curl -X PUT /api/connectors/limits -d '{"ses":200,"gmail":100,"resend":100}'`

**New MongoDB collections:**
- `TrackingEvents` — `{ email, event, bunch_id, timestamp, url?, ip? }` — indexes: `{ email, event }` + `{ bunch_id }`
- `EmailTemplates` — `{ name, html, isActive, createdAt, updatedAt }` — unique partial index on `{ isActive: true }`
- `ConnectorConfigs` — `{ name, dailyLimit, enabled, order }` — one doc per connector
- `ConnectorUsage` — `{ name, istDate, sent }` — compound unique index on `{ name, istDate }`; IST date = `YYYY-MM-DD` at UTC+5:30

**Connector credentials:**
- SES: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, from: `EMAIL_USER`
- Gmail: `EMAIL_USER2`, `EMAIL_PASS2` via Nodemailer SMTP `smtp.gmail.com:587`
- Resend: `resend_api_key`, from: `sourabh@referral.sourabhpathak.online` (hardcoded)

**Cloudflare Worker (`worker/`):**
- `worker/index.js` — handles `/track-open` (1x1 GIF + async POST /track-event) and `/track-link` (302 redirect + async POST)
- Deploy with `wrangler`; set `EXPRESS_API_URL` and `TRACK_SECRET` as Worker secrets
- `ctx.waitUntil()` ensures tracking is fire-and-forget (never blocks pixel/redirect)

**React Dashboard (`dashboard/`):**
- Stack: Vite + React 18 + Tailwind CSS + Recharts + React Router v6
- `npm run dev` in `dashboard/` — dev server at localhost:5173; proxies `/api` and `/auth` to `VITE_API_URL`
- `npm run build` — production build for Vercel
- Pages: Login (`/login`), Overview (`/`), Recipients (`/recipients`), Templates (`/templates`)
- Auth: JWT stored in `localStorage` as `trackmail_token`; response interceptor clears on 401
- Set `VITE_API_URL` in `.env` (or Vercel env vars) to point to the deployed Express server
- Update `vercel.json` rewrites with the actual backend URL before deploying

**Env vars:**
```
MONGODB_URI=          # MongoDB connection string
EMAIL_USER=           # SES verified sender address (From:)
AWS_ACCESS_KEY_ID=    # IAM key with ses:SendEmail permission
AWS_SECRET_ACCESS_KEY=
AWS_REGION=           # SES region (default: ap-south-1)
DASHBOARD_PASSWORD=   # password for dashboard login
JWT_SECRET=           # secret for signing JWTs
TRACK_SECRET=         # shared secret between server and Cloudflare Worker
DASHBOARD_ORIGIN=     # allowed CORS origin (e.g. https://your-dashboard.vercel.app)
TRACKING_WORKER_URL=  # Cloudflare Worker base URL (e.g. https://trackmail-pixel.workers.dev)
VITE_API_URL=         # Express API URL for dashboard (e.g. https://your-api.railway.app)
EXPRESS_API_URL=      # (Worker) same as above, set as wrangler secret
GROQ_API_KEY=         # Groq API key for evaluate-eligibility.js (free at console.groq.com)
```

**GitHub Actions (`.github/workflows/daily-pipeline.yml`)**
- Three-job pipeline: `scrape` (03:00 UTC) → `evaluate` → `send` (chunk 0 at 04:03, chunk 1 at 08:07, chunk 2 at 11:02)
- On manual `workflow_dispatch`: scrape → evaluate → send run sequentially
- On send-window crons: scrape and evaluate are skipped; send reads yesterday's evaluated docs
- Secrets required: `MONGODB_URI`, `EMAIL_USER`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `LINKEDIN_EMAIL`, `LINKEDIN_PASSWORD`, `GROQ_API_KEY`
- Database/collection names are hardcoded in the workflow env (`Linkedin_scrape` / `Emails`); `search_page.py` reads them from `MONGODB_DATABASE` / `MONGODB_COLLECTION` env vars

## Key details

- `bunch_id` format is `DDMMYY` (e.g. `280326` for 28 Mar 2026) — generated identically in both Python (`datetime.now().strftime("%d%m%y")`) and Node (`todayBunchID()`)
- The scraper uses a single browser context for all tabs to avoid multiple LinkedIn logins; parallelism is simulated via round-robin scrolling, not true threads
- Saved session (`linkedin_context.json`) is reused for up to 24 hours; delete it to force re-login
- Send rate is governed by the random jitter delay (`SEND_DELAY_MIN_MS`/`SEND_DELAY_MAX_MS`, default 45–90s) between sends in the CLI script
- The email template (`test.html`) must remain a single line after loading — `loadTemplate()` strips all newlines before use
- `Emails` doc status lifecycle: `"scraped"` (written by Python scraper) → `"evaluated"` (written by evaluator) → `"sent"` | `"skipped"` (written by sender)
- The only placeholder in `test.html` body is `{{PersonalizationHook}}`; never add `{{Name}}`, `{{Company}}`, etc.
- Evaluator Groq model: `llama-3.3-70b-versatile`; JSON mode via `response_format: {type: "json_object"}`; 3 retries with exponential backoff on 429s; docs missing `post_text` are auto-skipped with score 0; Groq is free (1,000 req/day, no credit card) at console.groq.com
