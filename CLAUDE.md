# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Sender (Node.js)
node send-daily-emails.js                        # send today's batch
DRY_RUN=true node send-daily-emails.js           # preview without sending
BUNCH_ID=280326 node send-daily-emails.js        # re-send a specific day's batch

# Scraper (Python)
cd scraper && python main.py                     # headless (default)
cd scraper && HEADLESS_MODE=false python main.py # headed browser for debugging

# Express API server
node server.js          # or: npm start
npm run dev             # nodemon with auto-reload

# Docker
docker build -t trackmail . && docker run --env-file .env trackmail
```

**Required env vars:** `MONGODB_URI`, `EMAIL_USER`, `EMAIL_PASS` (Gmail App Password), `LINKEDIN_EMAIL`, `LINKEDIN_PASSWORD`

## Architecture

Two independent subsystems that share a MongoDB database (`Linkedin_scrape`):

**Python scraper (`scraper/`)**
- `main.py` — entry point; reads `LINKEDIN_LINKS` from `config/linkedin_links.py`, launches Playwright browser, calls `LinkedInScraper.scrape_multiple_links()`
- `scraper.py` — `LinkedInScraper` class; uses round-robin tab scrolling (single browser context, multiple tabs) to collect emails; saves session to `linkedin_context.json` to avoid re-login within 24 hours
- `pages/search_page.py` — `LinkedInSearchPage` writes each extracted email directly to MongoDB (`Emails` collection) with a `bunch_id` in `DDMMYY` format
- `config/settings.py` — all scroll timing, parallel worker count, and stop-condition thresholds
- To add new LinkedIn search URLs: edit `config/linkedin_links.py` or run `python add_links.py`

**Node.js mailer (`send-daily-emails.js`)**
- Reads `Emails` collection filtered by `bunch_id = DDMMYY` (today, or `BUNCH_ID` env override)
- Skips emails already in `AlreadySent` collection (unique index on `email` field)
- Personalizes `test.html` template by replacing `{{Name}}`, `{{Company}}`, `{{Role}}`, `{{CalendlyLink}}`, `{{ResumeLink}}`, `{{YourEmail}}` placeholders
- Injects open-tracking pixel and click-tracking redirects via `https://test-open.sppathak1428.workers.dev`
- Sends via Gmail SMTP (port 465, pooled, rate-limited to 20/min)
- Retries failed sends up to 3× with exponential backoff; 1.2 s delay between each send

**Express API (`server.js` + `mailer.js`)**
- `mailer.js` — singleton Nodemailer transporter, exported as `{ transporter, sendEmail }`
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
- `POST /send-email` — JWT-protected
- `POST /send-bulk-emails` — JWT-protected

**New MongoDB collections:**
- `TrackingEvents` — `{ email, event, bunch_id, timestamp, url?, ip? }` — indexes: `{ email, event }` + `{ bunch_id }`
- `EmailTemplates` — `{ name, html, isActive, createdAt, updatedAt }` — unique partial index on `{ isActive: true }`

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

**New env vars:**
```
DASHBOARD_PASSWORD=   # password for dashboard login
JWT_SECRET=           # secret for signing JWTs
TRACK_SECRET=         # shared secret between server and Cloudflare Worker
DASHBOARD_ORIGIN=     # allowed CORS origin (e.g. https://your-dashboard.vercel.app)
TRACKING_WORKER_URL=  # Cloudflare Worker base URL (e.g. https://trackmail-pixel.workers.dev)
VITE_API_URL=         # Express API URL for dashboard (e.g. https://your-api.railway.app)
EXPRESS_API_URL=      # (Worker) same as above, set as wrangler secret
```

**GitHub Actions (`.github/workflows/daily-pipeline.yml`)**
- Runs daily at 12:00 PM UTC (5:30 PM IST): `scrape` job → `send` job (sequential, `needs: scrape`)
- Manual trigger supports `dry_run` and `bunch_id` inputs
- Secrets required: `MONGODB_URI`, `EMAIL_USER`, `EMAIL_PASS`, `LINKEDIN_EMAIL`, `LINKEDIN_PASSWORD`
- Database/collection names are hardcoded in the workflow env (`Linkedin_scrape` / `Emails`); `search_page.py` reads them from `MONGODB_DATABASE` / `MONGODB_COLLECTION` env vars

## Key details

- `bunch_id` format is `DDMMYY` (e.g. `280326` for 28 Mar 2026) — generated identically in both Python (`datetime.now().strftime("%d%m%y")`) and Node (`todayBunchID()`)
- The scraper uses a single browser context for all tabs to avoid multiple LinkedIn logins; parallelism is simulated via round-robin scrolling, not true threads
- Saved session (`linkedin_context.json`) is reused for up to 24 hours; delete it to force re-login
- Gmail rate limit: Nodemailer pool is configured at `maxConnections: 1, rateLimit: 20` (20 emails/min); there is also a hard-coded 1200 ms sleep between sends in the CLI script
- The email template (`test.html`) must remain a single line after loading — `loadTemplate()` strips all newlines before use
