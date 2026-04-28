# Trackmail Dashboard — Redesign & Improvement Guide

## Why the Current Dashboard Fails

The existing dashboard is **batch-centric** (everything revolves around a bunchId dropdown) and **vanity-metric heavy** (opens, clicks, rates). For a job-hunting cold email tool, the user needs answers to:

1. **"Who should I follow up with today?"** — Currently impossible to answer.
2. **"Which companies are engaging with my emails?"** — Buried inside a raw recipient table.
3. **"Is my outreach actually working?"** — Open rates don't mean anything; replies and interviews do.
4. **"Which email template performs better?"** — No A/B comparison exists.
5. **"Am I emailing the same companies twice?"** — Dedup is per-email, not per-company.

The redesign must shift from **"here are your numbers"** to **"here's what to do next."**

---

## New Data Model Requirements

### MongoDB — New Collections / Fields Needed

#### Collection: `Replies` (NEW)
Track when a recipient responds. This can be populated manually via the dashboard or automated via Gmail API polling.

```json
{
  "email": "recruiter@company.com",
  "repliedAt": "2026-03-29T...",
  "sentiment": "positive" | "negative" | "neutral",
  "notes": "Asked for resume, scheduling call",
  "stage": "replied" | "interview_scheduled" | "rejected" | "offer"
}
```

#### Collection: `FollowUps` (NEW)
Track follow-up scheduling.

```json
{
  "email": "recruiter@company.com",
  "followUpDate": "2026-04-01",
  "followUpNumber": 1,
  "status": "pending" | "sent" | "skipped",
  "reason": "No open after 3 days"
}
```

#### Extend `AlreadySent` with tracking fields
```json
{
  "email": "person@company.com",
  "sentAt": "2026-03-28T...",
  "bunchId": "280326",
  "templateId": "template_a",       // NEW — which template was used
  "opened": false,                    // NEW — tracking pixel fired
  "openedAt": null,                   // NEW
  "clicked": false,                   // NEW — link clicked
  "clickedAt": null,                  // NEW
  "replied": false,                   // NEW — got a reply
  "repliedAt": null,                  // NEW
  "company": "Company Inc",           // NEW — denormalized for faster queries
  "role": "Frontend Engineer"         // NEW — denormalized
}
```

### New API Endpoints Needed

| Endpoint | Method | Purpose |
|---|---|---|
| `GET /api/follow-ups` | GET | Recipients who opened but didn't reply, grouped by urgency |
| `GET /api/companies` | GET | Company-level aggregation: total sent, opened, replied per company |
| `GET /api/pipeline` | GET | Funnel: total sent → opened → clicked → replied → interview → offer |
| `GET /api/template-comparison` | GET | Per-template open/click/reply rates |
| `POST /api/replies` | POST | Manually log a reply with sentiment + notes + stage |
| `PUT /api/recipients/:email/stage` | PUT | Update a recipient's pipeline stage |
| `GET /api/daily-digest` | GET | Today's action items: follow-ups due, new opens, new replies |

---

## New Page Structure

### Page 1: Action Center `/` (replaces Overview)

This is the landing page. It answers: **"What should I do right now?"**

#### Section 1: Today's Actions (top, full width)
A card-based layout with 3 columns:

| Card | Content | Priority |
|---|---|---|
| **Follow Up Now** | Recipients who opened 2-3 days ago but haven't replied. Show name, company, role, open count, last opened timestamp. Each row has a "Mark Followed Up" button. | 🔴 High |
| **Hot Leads** | Recipients who opened 3+ times or clicked a link in the last 48 hours. These people are interested — act fast. | 🟡 Medium |
| **New Replies** | Replies received since last login. Show email, company, sentiment badge, and a button to update pipeline stage. | 🟢 Immediate |

#### Section 2: Pipeline Funnel (horizontal bar or Sankey-style)
```
Scraped (420) → Sent (380) → Opened (95) → Clicked (32) → Replied (12) → Interview (4) → Offer (1)
```
- This is a CUMULATIVE view across ALL batches, not per-bunchId.
- Each stage is clickable → filters the recipient table to that stage.
- Show conversion rates between each stage.

#### Section 3: This Week vs Last Week (compact comparison)
Two-column stat comparison:

| Metric | This Week | Last Week | Trend |
|---|---|---|---|
| Emails Sent | 45 | 62 | ↓ 27% |
| Open Rate | 28% | 22% | ↑ 6% |
| Replies | 3 | 1 | ↑ 200% |

Use green/red arrows for trend direction. Keep this tight — 4-5 rows max.

---

### Page 2: Recipients `/recipients` (enhanced)

#### Changes from current:
1. **Remove bunchId dropdown as the primary filter.** Replace with multi-filter bar:
   - Search (email, name, company)
   - Stage filter: All | Sent | Opened | Clicked | Replied | Interview | Rejected
   - Date range picker (sent date)
   - Batch filter (secondary, collapsible)

2. **Add columns:**
   - `Stage` — colored badge (Sent=gray, Opened=blue, Replied=green, Interview=purple, Rejected=red)
   - `Last Activity` — relative timestamp of most recent event (open, click, reply)
   - `Open Count` — how many times they opened (repeat opens = high interest signal)
   - `Follow-up #` — how many follow-ups sent (0, 1, 2, 3)
   - `Template` — which template was used

3. **Row actions (right-click or action menu):**
   - "Log Reply" → modal to record reply sentiment + notes
   - "Schedule Follow-up" → set follow-up date
   - "Move to Stage" → dropdown to change pipeline stage
   - "Open in Gmail" → deep link to Gmail search for that email address

4. **Default sort:** by `Last Activity` descending (most recent activity first), not by sent date.

---

### Page 3: Companies `/companies` (NEW page)

Company-level view — because when job hunting, you care about companies, not individual emails.

#### Table columns:
| Column | Details |
|---|---|
| Company | Domain/company name |
| People Contacted | Count of unique emails sent to this domain |
| Open Rate | % of people who opened |
| Replies | Count of replies from this company |
| Best Stage | Furthest pipeline stage reached at this company |
| Last Activity | Most recent event from anyone at this company |

#### Key feature: Click a company row → expands to show all recipients at that company with their individual statuses.

#### Insight: Flag companies where 3+ people were contacted but 0 opened → likely landing in spam or wrong contacts.

---

### Page 4: Templates `/templates` (enhanced)

#### Add template performance comparison:

| Template | Times Used | Open Rate | Click Rate | Reply Rate | Best For |
|---|---|---|---|---|---|
| Template A (casual) | 120 | 31% | 8% | 4.2% | Startups |
| Template B (formal) | 95 | 22% | 5% | 2.1% | Enterprise |

- Show a side-by-side bar chart comparing open/click/reply rates.
- Auto-tag "Winner" on the better-performing template.
- When creating a new template, suggest using the structure of the best performer.

---

### Page 5: Analytics `/analytics` (NEW page)

Deep-dive analytics for people who want to optimize their outreach.

#### Section 1: Send Time Analysis
Heatmap (day of week × hour of day) showing when opens happen. This tells the user when to schedule sends for maximum engagement.

#### Section 2: Response Lag Distribution
Histogram: "How many hours/days after sending do people typically open?"
This informs follow-up timing strategy.

#### Section 3: Domain Deliverability
Table showing open rates per email domain (@gmail.com, @company.com, etc.). If a domain has 0% opens across 20+ sends, flag it as potential spam issue.

#### Section 4: Weekly Trend Lines
Line chart with 3 lines: Sent, Opened, Replied — plotted per week over the last 8 weeks. Shows if outreach volume and quality are improving.

---

## UI/UX Principles for the Rebuild

### 1. Kill the BunchSelector as Primary Navigation
Batches (bunchId) are an implementation detail. Users think in terms of "this week's outreach" or "Company X", not "batch 280326". Move batch filtering to a secondary/advanced filter.

### 2. Color System for Pipeline Stages
Use consistent colors everywhere:
```
Sent      → gray-400    (#9CA3AF)
Opened    → blue-500    (#3B82F6)
Clicked   → yellow-500  (#EAB308)
Replied   → green-500   (#22C55E)
Interview → purple-500  (#A855F7)
Offer     → emerald-600 (#059669)
Rejected  → red-400     (#F87171)
```

### 3. Empty States Must Be Actionable
Don't just show "No data." Show:
- "No follow-ups due today. You're all caught up! 🎉"
- "No replies yet. Consider following up with people who opened 3+ days ago → [View Hot Leads]"

### 4. Mobile-Friendly
The Action Center page especially should work on mobile — job hunters check their pipeline from their phone constantly.

### 5. Skeleton Loaders
Keep the existing skeleton loading pattern. It's good UX.

---

## Implementation Priority

### Phase 1: Data Foundation (Backend First)
1. Add `opened`, `openedAt`, `clicked`, `clickedAt`, `company`, `role`, `templateId` fields to `AlreadySent` documents
2. Create `Replies` collection
3. Build `/api/follow-ups`, `/api/companies`, `/api/pipeline` endpoints
4. Build `POST /api/replies` endpoint

### Phase 2: Action Center
1. Replace Overview page with the Action Center layout
2. Build the Pipeline Funnel component (cumulative, all-time)
3. Build the Follow-Up Now / Hot Leads / New Replies cards
4. Build the week-over-week comparison strip

### Phase 3: Enhanced Recipients
1. Add multi-filter bar (replace bunchId-only filter)
2. Add new columns (Stage, Open Count, Last Activity, Follow-up #)
3. Add row action menu (Log Reply, Schedule Follow-up, Move Stage)
4. Change default sort to Last Activity desc

### Phase 4: Companies Page
1. Build the company aggregation endpoint
2. Build the companies table with expandable rows
3. Add the "likely spam" flag for 0% open rate companies

### Phase 5: Template Comparison & Analytics
1. Add templateId tracking to send flow
2. Build template performance comparison table + chart
3. Build Analytics page (send time heatmap, response lag, trends)

---

## Tech Stack Notes (for Claude Code)

- **Frontend:** React (Vite), already in place
- **Charts:** Use Recharts (already a dependency for the area chart on timeline)
- **Backend:** Express.js (`server.js`), already in place
- **Database:** MongoDB Atlas (`Linkedin_scrape` database)
- **Auth:** JWT stored in localStorage, auto-injected via `api.js`
- **Styling:** Keep whatever CSS approach is currently used (check if Tailwind or plain CSS)

### Key constraint: The dashboard has NO network access in Claude's sandbox. All changes should be structured as discrete, testable file modifications. Don't attempt to run the dev server or connect to MongoDB from Claude's environment.

### File changes will typically touch:
- `src/pages/` — page components
- `src/components/` — shared UI components
- `server.js` — API routes
- `src/api.js` — frontend API client functions

---

## Metrics That Actually Matter for Job Hunting

Prioritize displaying these in this order:

1. **Replies received** — the only metric that directly leads to interviews
2. **Follow-ups needed** — unreplied opens are wasted opportunities
3. **Company coverage** — are you reaching the right companies?
4. **Template effectiveness** — is your messaging working?
5. **Open rate** — secondary signal, useful for subject line optimization
6. **Send volume** — are you doing enough outreach?
7. **Click rate** — tertiary, shows resume/portfolio interest

Do NOT prominently display:
- Raw sent count without context
- "Came Back" as a standalone metric (fold it into open count)
- Per-batch stats in isolation (always show cumulative + trend)