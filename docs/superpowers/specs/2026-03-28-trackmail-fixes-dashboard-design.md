# Trackmail — Bug Fixes + Analytics Dashboard

**Date:** 2026-03-28
**Status:** Approved
**Scope:** Production hardening of existing pipeline + React analytics dashboard with email template editor

---

## 1. Goals

1. Fix all critical and important issues identified in the pre-deployment code review.
2. Add a React/Vite analytics dashboard (deployed to Vercel) showing emails sent, opened, clicked, and came back.
3. Add a template editor in the dashboard so the active email HTML can be changed without touching the filesystem.
4. Keep everything on free tiers: Render (Express), Vercel (React), MongoDB Atlas M0, Cloudflare Worker (existing).

---

## 2. Bug Fixes

### 2.1 `send-daily-emails.js`
- **Remove** `tls: { rejectUnauthorized: false }` from the Nodemailer transporter config. Gmail's cert is valid; Nodemailer defaults are correct for port 465.
- **Strengthen email validation**: replace `e.includes("@")` with `/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)`.
- **Skip permanent SMTP errors on retry**: check `error.responseCode`; do not retry `5xx` codes (e.g. 550 User unknown). Only retry on transient errors (4xx, network errors).
- **Active template loading**: read the active template HTML from MongoDB `EmailTemplates` collection (field `isActive: true`). Fall back to `test.html` if no active template is set.

### 2.2 `server.js`
- **Fail-fast on missing `MONGODB_URI`**: change `console.warn` to `throw new Error(...)` at startup.
- **Graceful shutdown**: add `process.on('SIGTERM', ...)` and `process.on('SIGINT', ...)` handlers that call `mongoClient.close()`.
- **Remove unused import**: remove `ObjectId` from the `mongodb` destructure.
- **Restrict CORS**: replace `cors()` with `cors({ origin: [process.env.DASHBOARD_ORIGIN, 'http://localhost:5173'] })`.
- **JWT auth middleware**: protect all `/api/*` and `/send-*` routes. `POST /auth/login`, `POST /track-event`, and `GET /health` are public.

### 2.3 `mailer.js`
- **Startup credential verification**: call `transporter.verify()` at module load time (wrapped in try/catch that logs and exits if it fails).

### 2.4 `scraper/pages/search_page.py`
- **Shared MongoClient**: remove `MongoClient` creation from `LinkedInSearchPage.__init__`. Accept a `mongo_client` argument passed in from `scraper.py`. `scraper.py` creates one client for the entire scrape session and closes it when done.

### 2.5 `scraper/pages/login_page.py`
- **Conditional debug screenshots**: wrap all `page.screenshot(...)` calls in `if os.getenv('DEBUG_SCREENSHOTS'):`.

### 2.6 `.gitignore`
Add:
```
scraper/linkedin_context.json
scraper/debug_*.png
scraper/*.csv
```

### 2.7 `package.json`
Remove unused dependencies: `ioredis`, `redis`, `axios`.

---

## 3. New MongoDB Collections

### `TrackingEvents`
One document per tracking event.

```js
{
  email: String,          // recipient email
  event: String,          // "open" | "click" | "comeback"
  url: String,            // populated for "click" events only
  bunch_id: String,       // DDMMYY
  timestamp: Date,
  ip: String,             // optional, from CF-Connecting-IP header
}
```

Index: `{ email: 1, event: 1 }` for fast per-recipient queries.

**"Came back" definition:** A recipient "came back" if they have more than one `click` event for the same `bunch_id` (i.e. they clicked a tracked link more than once). This is computed as a query on `TrackingEvents` — no separate event type needed. No Cloudflare Worker changes required for this metric.

### `EmailTemplates`
One document per saved template.

```js
{
  name: String,           // human label, e.g. "March batch v2"
  html: String,           // full HTML string
  isActive: Boolean,      // only one document has isActive: true at a time
  createdAt: Date,
  updatedAt: Date,
}
```

---

## 4. New & Updated API Endpoints

### Auth
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | None | `{ password }` → `{ token }` (JWT, 7-day expiry) |

Password is compared against `DASHBOARD_PASSWORD` env var (bcrypt hash optional, plain comparison acceptable for personal use).

### Tracking (called by Cloudflare Worker)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/track-event` | Shared secret (`TRACK_SECRET` header) | `{ email, event, url?, bunch_id }` → writes to `TrackingEvents` |

### Dashboard API (JWT required)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/bunches` | List of all `bunch_id` values with sent counts, newest first |
| GET | `/api/stats?bunchId=X` | `{ sent, opens, clicks, comebacks, openRate, clickRate }` |
| GET | `/api/events?bunchId=X` | Per-recipient rows: `[ { email, sentAt, opened, clicked, cameBack } ]` |
| GET | `/api/templates` | List all templates (without full HTML) |
| GET | `/api/templates/active` | Return full HTML of active template |
| POST | `/api/templates` | Create template `{ name, html }` |
| PUT | `/api/templates/:id` | Update name or html |
| DELETE | `/api/templates/:id` | Delete (cannot delete active template) |
| POST | `/api/templates/:id/activate` | Set `isActive: true`, unset all others atomically |

### Existing endpoints updated
- `POST /send-email` and `POST /send-bulk-emails`: now JWT-protected.

---

## 5. Cloudflare Worker Update

Add a `notifyAPI` helper that `POST`s to `${EXPRESS_API_URL}/track-event` with:
```json
{ "email": "...", "event": "open|click|comeback", "url": "...", "bunch_id": "..." }
```
Header: `x-track-secret: <TRACK_SECRET>`.

Retry once on failure (network error or 5xx from Render cold start). If both attempts fail, the Worker still serves the pixel/redirect — tracking loss is acceptable over broken email links.

`bunch_id` is embedded in the tracking URL by `send-daily-emails.js` at send time:
```
/track-open?email=X&bid=DDMMYY
/track-link?email=X&url=Y&bid=DDMMYY
```

---

## 6. React Dashboard

### Stack
- React 18 + Vite
- Tailwind CSS (utility styling, no component library)
- Recharts (charts)
- Axios (HTTP, with auth interceptor)
- React Router v6 (routing)

### Folder structure
```
trackmail/
  dashboard/
    src/
      pages/
        Login.jsx
        Overview.jsx
        Recipients.jsx
        Templates.jsx
      components/
        StatCard.jsx
        EventFeed.jsx
        RecipientTable.jsx
        TemplateEditor.jsx
        BunchSelector.jsx
        Navbar.jsx
      api.js            ← Axios instance; attaches Bearer token; redirects to /login on 401
      App.jsx
      main.jsx
    vite.config.js      ← proxy /api and /auth to VITE_API_URL in dev
    vercel.json         ← rewrite /api/* and /auth/* → Express on Render
    package.json
```

### Pages

**`/login`**
- Single password field + submit button
- Calls `POST /auth/login`; stores JWT in `localStorage`
- Redirects to `/` on success

**`/` (Overview)**
- Bunch ID dropdown (populated from `/api/bunches`)
- 4 stat cards: Sent, Opened, Clicked, Came Back (with % rates)
- Line chart: opens + clicks over time (by hour for single day, by day for all-time)
- Recent activity feed: last 10 tracking events (email, event type, time ago)

**`/recipients`**
- Table: Email | Sent At | Opened | Clicked | Came Back
- Status badge per row
- Search by email, sort by any column
- Paginated (50 rows/page)

**`/templates`**
- Left panel: list of saved templates; active one has a green badge
- Right panel: HTML `<textarea>` editor + live preview in `<iframe srcdoc>`
- Buttons: Save, Set as Active, Delete
- "New template" button pre-fills editor with current `test.html` content

### Auth flow
- JWT stored in `localStorage` as `trackmail_token`
- Axios interceptor adds `Authorization: Bearer <token>` to every request
- On 401 response → clear token → redirect to `/login`
- Protected route wrapper: redirect to `/login` if no token present

---

## 7. Deployment

### Express API → Render
- Service type: Web Service (free tier)
- Build command: `npm ci --omit=dev`
- Start command: `node server.js`
- Health check path: `/health`
- Env vars: `MONGODB_URI`, `EMAIL_USER`, `EMAIL_PASS`, `DASHBOARD_PASSWORD`, `JWT_SECRET`, `TRACK_SECRET`, `DASHBOARD_ORIGIN`

### React Dashboard → Vercel
- Root directory: `dashboard/`
- Build command: `npm run build`
- Output directory: `dist`
- Env var: `VITE_API_URL=https://your-render-app.onrender.com`
- `vercel.json` rewrites `/api/*` and `/auth/*` to `VITE_API_URL`

### New required env vars summary
```
DASHBOARD_PASSWORD   password to log into the dashboard
JWT_SECRET           long random string for signing JWTs
TRACK_SECRET         shared secret between Cloudflare Worker and Express
DASHBOARD_ORIGIN     Vercel URL (e.g. https://trackmail.vercel.app) for CORS
```

---

## 8. Data Flow (end-to-end)

```
GitHub Actions (daily 12:00 UTC)
  scrape job → LinkedIn → MongoDB Emails (bunch_id = DDMMYY)
  send job   → send-daily-emails.js
                 reads active template from MongoDB EmailTemplates
                 injects tracking URLs (pixel + link rewrite with bid param)
                 sends via Gmail SMTP → recipient inbox

Recipient opens email
  → Cloudflare Worker /track-open?email=X&bid=DDMMYY
  → Worker POSTs { email, event:"open", bunch_id } to Express /track-event
  → Express writes to MongoDB TrackingEvents
  → Worker returns 1px GIF

Recipient clicks link
  → Cloudflare Worker /track-link?email=X&url=Y&bid=DDMMYY
  → Worker POSTs { email, event:"click", url, bunch_id } to Express /track-event
  → Worker redirects browser to Y

Dashboard user
  → Vercel (React) → GET /api/stats?bunchId=X → Express → MongoDB aggregate
  → Displays stats, recipient table, template editor
```

---

## 9. Out of Scope

- Reply detection (would require Gmail API integration)
- Unsubscribe link (can be added later as a tracked link type)
- Multi-user auth (single password is sufficient for personal use)
- Render keep-warm cron (can be added later if cold starts cause tracking loss)
