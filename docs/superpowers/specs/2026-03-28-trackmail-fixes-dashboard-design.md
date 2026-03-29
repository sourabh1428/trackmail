# Trackmail — Bug Fixes + Analytics Dashboard (Claude Code Prompt)

Read every file in the project before making any changes. Implement ALL of the following in order. Do not skip any item. After each section, commit with a descriptive message.

---

## PHASE 1: Bug Fixes (apply to existing files)

### 1.1 `send-daily-emails.js`
- **Remove** `tls: { rejectUnauthorized: false }` from the Nodemailer transporter config. Gmail's cert is valid; Nodemailer defaults are correct for port 465.
- **Strengthen email validation**: replace `e.includes("@")` with `/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)`.
- **Skip permanent SMTP errors on retry**: check `error.responseCode`; do NOT retry `5xx` codes (e.g. 550 User unknown). Only retry on transient errors (4xx, network errors).
- **Active template loading**: read the active template HTML from MongoDB `EmailTemplates` collection (field `isActive: true`). Fall back to `test.html` on disk if no active template exists in MongoDB.
- **Inject tracking URLs**: when building each email, rewrite all `<a href="...">` links to go through the Cloudflare Worker tracking URL: `https://<WORKER_URL>/track-link?email=<RECIPIENT>&url=<ORIGINAL_URL>&bid=<BUNCH_ID>`. Also inject a 1px tracking pixel before `</body>`: `<img src="https://<WORKER_URL>/track-open?email=<RECIPIENT>&bid=<BUNCH_ID>" width="1" height="1" style="display:none" />`. Use `TRACKING_WORKER_URL` env var for the worker base URL.

### 1.2 `server.js`
- **Fail-fast on missing `MONGODB_URI`**: change `console.warn` to `throw new Error(...)` at startup.
- **Graceful shutdown**: add `process.on('SIGTERM', ...)` and `process.on('SIGINT', ...)` handlers that call `mongoClient.close()`.
- **Remove unused import**: remove `ObjectId` from the `mongodb` destructure if present.
- **Restrict CORS**: replace `cors()` with `cors({ origin: [process.env.DASHBOARD_ORIGIN, 'http://localhost:5173'] })`.
- **JWT auth middleware**: protect all `/api/*` and `/send-*` routes. Keep `POST /track-event`, `POST /auth/login`, and `GET /health` public. Use `jsonwebtoken` package. Token is verified against `JWT_SECRET` env var.
- **Add `POST /auth/login`**: accepts `{ password }`, compares against `DASHBOARD_PASSWORD` env var (plain string comparison is fine), returns `{ token }` (JWT, 7-day expiry).
- **Add `POST /track-event`**: accepts `{ email, event, url?, bunch_id }` with `x-track-secret` header validated against `TRACK_SECRET` env var. Writes to MongoDB `TrackingEvents` collection.
- **Add these dashboard API routes** (all JWT-protected):
  - `GET /api/bunches` — list all distinct `bunch_id` values from `Emails` collection with sent counts, sorted newest first.
  - `GET /api/stats?bunchId=X` — returns `{ sent, opens, clicks, comebacks, openRate, clickRate }`. "Comeback" = recipients with >1 click event for same bunch_id.
  - `GET /api/events?bunchId=X` — per-recipient rows: `[{ email, sentAt, opened, clicked, cameBack }]`. Join `Emails`, `AlreadySent`, and `TrackingEvents`.
  - `GET /api/templates` — list all templates from `EmailTemplates` collection (return name, isActive, createdAt, updatedAt — NOT the full html).
  - `GET /api/templates/active` — return full HTML of the active template.
  - `POST /api/templates` — create template `{ name, html }`, set `isActive: false`, timestamps.
  - `PUT /api/templates/:id` — update name or html, set `updatedAt`.
  - `DELETE /api/templates/:id` — delete, but reject if `isActive: true`.
  - `POST /api/templates/:id/activate` — use MongoDB `bulkWrite`: first `updateMany` to set all `isActive: false`, then `updateOne` to set this doc `isActive: true`.

### 1.3 `mailer.js`
- **Startup credential verification**: call `transporter.verify()` at module load time (wrapped in try/catch that logs and exits with `process.exit(1)` if it fails).

### 1.4 `scraper/pages/search_page.py` (or wherever MongoClient is created in scraper)
- **Shared MongoClient**: remove `MongoClient` creation from individual page classes. Accept a `mongo_client` argument passed in from the main scraper entry point. The entry point creates one client for the entire scrape session and closes it in a `finally` block.

### 1.5 `scraper/pages/login_page.py`
- **Conditional debug screenshots**: wrap all `page.screenshot(...)` calls in `if os.getenv('DEBUG_SCREENSHOTS'):`.

### 1.6 `.gitignore`
Add these lines if not already present:
```
scraper/linkedin_context.json
scraper/debug_*.png
scraper/*.csv
```

### 1.7 `package.json`
- Remove unused dependencies: `ioredis`, `redis`, `axios` (only if they're listed and not actually imported anywhere in the codebase — verify before removing).
- Add dependencies: `jsonwebtoken`, `bcryptjs` (if not already present).

---

## PHASE 2: MongoDB Collections Setup

Create a helper script `scripts/setup-indexes.js` that:
1. Connects to MongoDB using `MONGODB_URI`
2. Creates index `{ email: 1, event: 1 }` on `TrackingEvents`
3. Creates unique index `{ isActive: 1 }` partial filter `{ isActive: true }` on `EmailTemplates` (ensures only one active template)
4. Logs success and exits

---

## PHASE 3: Cloudflare Worker Update

Read the existing Cloudflare Worker code (it handles `/track-open` and `/track-link` routes).

Update it to:
1. Parse `bid` (bunch_id) query param from tracking URLs in addition to existing params.
2. After serving the tracking pixel (for opens) or redirect (for clicks), POST the event to the Express API:
   ```
   POST ${EXPRESS_API_URL}/track-event
   Headers: { "Content-Type": "application/json", "x-track-secret": TRACK_SECRET }
   Body: { "email": "...", "event": "open|click", "url": "..." (clicks only), "bunch_id": "..." }
   ```
3. Use `event.waitUntil(fetch(...))` so the tracking POST happens asynchronously — never block the pixel/redirect response.
4. Retry once on network error or 5xx. If both fail, silently drop (tracking loss is acceptable, broken links are not).
5. The Worker env vars needed: `EXPRESS_API_URL`, `TRACK_SECRET`.

---

## PHASE 4: React Dashboard

Create a new `dashboard/` directory at the project root. Initialize with Vite + React:

```
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
    api.js
    App.jsx
    main.jsx
  vite.config.js
  vercel.json
  tailwind.config.js
  package.json
```

### Stack
- React 18 + Vite
- Tailwind CSS (utility classes only, no component library)
- Recharts (for charts)
- Axios (HTTP client)
- React Router v6

### `api.js`
- Create an Axios instance with `baseURL` from `import.meta.env.VITE_API_URL` or empty string (for Vercel rewrites).
- Request interceptor: attach `Authorization: Bearer <token>` from `localStorage.getItem('trackmail_token')`.
- Response interceptor: on 401, clear token from localStorage, redirect to `/login`.

### `vite.config.js`
- Proxy `/api` and `/auth` to `VITE_API_URL` env var in dev mode.

### `vercel.json`
```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "<VITE_API_URL>/api/:path*" },
    { "source": "/auth/:path*", "destination": "<VITE_API_URL>/auth/:path*" }
  ]
}
```
Note: the actual URL will be set by the user — use a placeholder.

### Pages

**Login (`/login`)**
- Single password input + submit button
- Calls `POST /auth/login` with `{ password }`
- On success: stores JWT in `localStorage` as `trackmail_token`, redirects to `/`
- On error: shows error message
- Clean, centered card layout

**Overview (`/`)**
- Protected route (redirect to `/login` if no token)
- `BunchSelector` dropdown at top — populated from `GET /api/bunches`
- 4 `StatCard` components in a row: Sent, Opened (with %), Clicked (with %), Came Back (with %)
- Data from `GET /api/stats?bunchId=X`
- Line chart (Recharts `LineChart`): opens + clicks over time
- `EventFeed` component: last 10 tracking events showing email, event type, relative time

**Recipients (`/recipients`)**
- Protected route
- `BunchSelector` at top
- `RecipientTable`: columns = Email, Sent At, Opened, Clicked, Came Back
- Each boolean column shows a colored badge (green check / gray dash)
- Search input to filter by email
- Client-side sort by any column
- Paginated at 50 rows/page
- Data from `GET /api/events?bunchId=X`

**Templates (`/templates`)**
- Protected route
- Two-panel layout:
  - **Left panel**: list of saved templates from `GET /api/templates`. Active template has a green "Active" badge. Click to select.
  - **Right panel**: `TemplateEditor` component
    - HTML `<textarea>` (full width, tall) showing selected template's HTML (fetched on select)
    - Below textarea: live preview in `<iframe srcDoc={html} sandbox />` 
    - Buttons: "Save" (`PUT /api/templates/:id`), "Set as Active" (`POST /api/templates/:id/activate`), "Delete" (`DELETE /api/templates/:id`)
- "New Template" button: pre-fills textarea with the active template's HTML, prompts for name, creates via `POST /api/templates`

### Navbar
- Links: Overview, Recipients, Templates
- Right side: "Logout" button (clears token, redirects to `/login`)
- Highlight active route

### Styling
- Use Tailwind utility classes throughout
- Dark-ish theme: slate/zinc backgrounds, white text, blue accents
- Responsive: stack cards vertically on mobile
- No component library — raw Tailwind only

---

## PHASE 5: Environment Variables

Update `.env.example` (create if it doesn't exist) with all required env vars:

```
# Existing
MONGODB_URI=
EMAIL_USER=
EMAIL_PASS=
LINKEDIN_EMAIL=
LINKEDIN_PASSWORD=

# New — Server
DASHBOARD_PASSWORD=
JWT_SECRET=
TRACK_SECRET=
DASHBOARD_ORIGIN=
TRACKING_WORKER_URL=

# New — Dashboard (Vite)
VITE_API_URL=

# New — Cloudflare Worker
EXPRESS_API_URL=
```

---

## PHASE 6: Update the CLAUDE.md / skill docs

After all changes are done, update any CLAUDE.md or project documentation to reflect:
- New file structure (dashboard/, scripts/)
- New MongoDB collections (TrackingEvents, EmailTemplates)
- New API endpoints
- New env vars
- Updated data flow diagram

---

## IMPORTANT RULES

1. Read every file you're about to modify BEFORE modifying it.
2. Do NOT delete or bypass the AlreadySent dedup logic — it is critical.
3. Preserve DRY_RUN mode in send-daily-emails.js.
4. Use existing code style and patterns — match the project's conventions.
5. Install new npm packages with `npm install`, not by hand-editing package.json.
6. For the dashboard, run `npm create vite@latest dashboard -- --template react` then install tailwind, recharts, axios, react-router-dom.
7. Test that `server.js` still starts correctly after all changes.
8. Do NOT hardcode any secrets or URLs — everything comes from env vars.