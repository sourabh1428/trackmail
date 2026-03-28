# trackmail

Automated daily cold-email pipeline. Every day it:
1. Scrapes LinkedIn for hiring posts and extracts emails → MongoDB
2. Sends personalized, tracked cold emails to the day's batch

```
scraper/        LinkedIn Playwright scraper (Python)
send-daily-emails.js   Bulk email sender (Node.js)
server.js       Optional Express API server
test.html       Email HTML template
.github/workflows/daily-pipeline.yml   Unified GitHub Actions pipeline
```

---

## How it works

```
GitHub Actions (12:00 PM UTC daily)
  └── Job 1: scrape
  │     └── python scraper/main.py
  │           → extracts emails from LinkedIn
  │           → saves to MongoDB: Emails collection, bunch_id = DDMMYY
  └── Job 2: send  (runs only after scrape succeeds)
        └── node send-daily-emails.js
              → reads today's bunch from MongoDB
              → skips already-sent (AlreadySent collection)
              → sends personalized + tracked emails via Gmail SMTP
              → marks each as sent
```

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/sourabh1428/trackmail.git
cd trackmail
npm install
pip install -r scraper/requirements.txt
python -m playwright install chromium
```

### 2. Create `.env` (local dev only)

```
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<db>?retryWrites=true&w=majority
EMAIL_USER=your@gmail.com
EMAIL_PASS=your_gmail_app_password
```

> **Gmail App Password**: Go to myaccount.google.com → Security → 2-Step Verification → App passwords

### 3. Add GitHub Secrets

Go to **Settings → Secrets and variables → Actions** in this repo:

| Secret | Value |
|--------|-------|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `EMAIL_USER` | Gmail address |
| `EMAIL_PASS` | Gmail App Password |
| `LINKEDIN_EMAIL` | LinkedIn login email |
| `LINKEDIN_PASSWORD` | LinkedIn password |

---

## Running locally

### Dry-run (preview without sending)

```bash
DRY_RUN=true node send-daily-emails.js
```

### Send today's batch for real

```bash
node send-daily-emails.js
```

### Override the bunchID (e.g. re-send a past day)

```bash
BUNCH_ID=270326 node send-daily-emails.js
```

### Run the scraper locally

```bash
cd scraper
HEADLESS_MODE=false python main.py   # headed mode, so you can see the browser
```

### Run the optional Express API server

```bash
node server.js
# POST /send-bulk-emails  { bunchID, subject, htmlTemplate }
# POST /send-email        { to, subject, html }
# GET  /health
```

---

## Email template

`test.html` is the cold-email template. It supports these placeholders:

| Placeholder | Default |
|-------------|---------|
| `{{Name}}` | `there` |
| `{{Company}}` | `your company` |
| `{{Role}}` | `SDE-1` |
| `{{CalendlyLink}}` | Google Calendar URL |
| `{{ResumeLink}}` | Google Drive resume link |
| `{{YourEmail}}` | `EMAIL_USER` env var |

Values are pulled from the recipient's MongoDB document fields (`name`, `company`, `role`).

---

## Updating LinkedIn search URLs

Edit `scraper/config/linkedin_links.py` and add/remove URLs from `LINKEDIN_LINKS`.

Or use the interactive helper:

```bash
cd scraper
python add_links.py
```

---

## MongoDB collections (database: `Linkedin_scrape`)

| Collection | Purpose |
|------------|---------|
| `Emails` | Scraped recipients. Each doc has `email`, `name`, `company`, `bunch_id` (DDMMYY), `timestamp` |
| `AlreadySent` | Dedup log. One doc per sent email — prevents re-sending across runs |

---

## Manual GitHub Actions trigger

Go to **Actions → Daily Pipeline → Run workflow**.
Set `dry_run: true` to preview without sending.

---

## Security note

- Never commit `.env` — it is in `.gitignore`
- Use Gmail App Passwords, not your main password
- Rotate any tokens that were accidentally exposed
