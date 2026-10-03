# PrognostiCare Staff Retention

Web app for scoring **pre-hire candidates** and **current staff** on retention risk.
A client uploads a CSV or Excel file, the app resolves each person to their public
social profiles, reads recent posts for pressure signals, combines that with commute
distance, tenure and job-class turnover, and returns a scored report.

One repository, one Vercel project: React (Vite) frontend plus an Express API that
runs as a single Vercel serverless function.

---

## Try it on your computer (2 minutes)

```bash
npm install
npm run dev            # opens the app at http://localhost:5173
```

No settings are needed. With no `MONGODB_URI`, `npm run dev` starts a private
database in `./.localdb` (the first run downloads MongoDB, about a minute). The
first screen asks you to create the administrator account. Then add a client
under *Admin > Clients & users*, sign in as that client, and upload
`samples/current_staff_sample.csv` or `samples/prehire_sample.csv`.

Other commands: `npm test` (unit tests; add `TEST_MONGODB_URI=...` to include the
full API test), `npm run build`, `npm start` (builds and serves app + API from one process).

## Deploy to Vercel

1. **Database.** Create a MongoDB Atlas cluster (Vercel *Storage > MongoDB Atlas*
   does this and sets `MONGODB_URI` for you). In Atlas *Network Access*, allow
   `0.0.0.0/0` so Vercel can connect. Use a new database, not the old app's.
2. **Project.** Push this folder to a private GitHub repo and import it in Vercel.
   Vercel detects Vite; no build settings to change.
3. **Environment variables.** Only `MONGODB_URI` is required. Recommended:
   `SETUP_TOKEN` (a key the first-run form will ask for, so nobody else can claim
   the admin account on a fresh deployment) and `APP_URL` (the public address).
   Everything else is optional; see `.env.example`.
4. **Deploy**, then open `/api/health`. It should show `"ok": true` and `"db": "connected"`.
5. **Open the app.** The sign-in page shows a one-time *Create the administrator
   account* form. After that, add clients under *Admin > Clients & users* and set
   each client's job site (used for commute distance).

If the sign-in page says *The app is not connected yet*, the message on that
screen names the problem (usually `MONGODB_URI` missing or Atlas blocking the connection).

With no provider keys the app runs in **demo mode**: the whole pipeline runs, and
social signals are simulated and labelled "DEMO" on every screen and export. Add
`PDL_API_KEY` and `RAPIDAPI_KEY` to switch to live data (`PROVIDER_MODE=auto`).

## How it works

```
Upload (CSV/XLSX, ≤4 MB)
  → preview: column mapping, duplicates, skipped rows, cost, monthly-limit check
  → create job: credits charged on the server, one Record per row saved in MongoDB
  → browser calls POST /api/jobs/:id/step in a loop; each step works ~40 s, then returns
       per record: enrichment (PDL) → posts (LinkedIn, X, Facebook via RapidAPI)
                   → keyword signals → distance / tenure / turnover → score
  → results page, Financial impact tab, Excel/CSV export
```

Processing in short steps keeps every request under Vercel's function time limit
and lets any instance resume a job. If the browser closes, the job pauses and
continues when the page is opened again (or an admin clicks *Resume*).

### Process rules (from "Retention Process Flow Update 1-28-26")

* **Current staff:** one run per client per calendar month; a second upload shows
  *"You have exceeded your processing limit for this month."* An admin can grant
  extra runs. Deleting a run does not give the month back. Each contact (email or
  phone) is scored at most once per month.
* **Pre-hire:** each upload is processed once; the same candidate applying to
  several requisitions in one file is scored and charged once.
* Terminated employees in a staff file are not scored; they are used to calculate
  annual turnover per job class, which is saved and reused for pre-hire runs.

### Scoring model (from "Retention Calculation.xlsx")

`Retention score = Distance + Tenure + Job-class turnover + Financial + Schedule + Work-Life Balance + Communication (+ Age, off by default)`

| Factor | Source | Points |
|---|---|---|
| Distance, Tenure, Age | spreadsheet WOE bands: share of "ideal staff" per band → centered log ratio → points table | -15 to +15 |
| Turnover | annual % for the job class | 0-10% = +12 … 60%+ = -20 |
| 4 domains | pressure 1-10 from posts | 1 = +7 … 6 = 0 … 10 = -7 |

Outlook: **Likely to stay** ≥ 20, **Watch** 0-19, **At risk** < 0. Points are not a
percentage or a probability.

Missing inputs (no address, no posts, unknown turnover) score **0** and are listed
in the record's notes. Nothing is ever randomised.

Social listening: last 60 days of posts; company-page reshares ignored; each risk
phrase adds its severity (1-3), repeats decay (100/50/25/10%); protective phrases
("paid well", "supportive manager") subtract 1; raw pressure = 1 + round(sum),
capped at 10. No posts, or fewer than 3 posts with no match, means "no signal".
Full post text is never stored, only matched phrases and counts.

Keyword library: `server/scoring/keywords.json`. Review it with
`npm run check:keywords` (`-- --csv` for a spreadsheet).

## Compliance notes (read before selling this)

This is not legal advice; have employment counsel review before live use.

* **Age** is a protected characteristic (ADEA, 40+). The age factor is off unless
  `ENABLE_AGE_FACTOR=true`, and it never applies to pre-hire.
* **Pre-hire social screening by a third party** can make PrognostiCare a consumer
  reporting agency under the FCRA (disclosure, written authorization, adverse-action
  notices). State laws (for example Colorado's AI Act and NYC Local Law 144) add
  duties for automated employment decision tools.
* **Current staff:** posts about pay, schedules and working conditions can be
  protected concerted activity under the NLRA. Position the output as retention
  support, not discipline.
* Scraping LinkedIn and Facebook through RapidAPI resellers may breach those sites'
  terms. Check the providers' terms and your contracts.
* Distance bands in the spreadsheet are the example distribution; with them,
  living under 5 miles scores **-5**. Recalibrate the bands from each client's own
  retained-staff data before production.

## Project layout

```
api/index.js              Vercel function entry (Express app)
server/app.js             routes, auth, error handling
server/pipeline.js        job steps and per-record processing
server/scoring/           model.js (points), signals.js (keywords), keywords.json
server/providers/         enrichment (PDL), social (RapidAPI), geocode (US Census)
server/lib/               file intake, normalisation, exports, email
src/                      React app (pages/, components/, lib/)
samples/                  synthetic test files (fictional people)
scripts/                  local server, seed admin, legacy migration, keyword check
tests/                    node:test unit + API tests
```

## Security design

* Sessions are httpOnly, SameSite cookies (page scripts never see the token);
  writes also require an app header, which blocks cross-site requests.
* Passwords are bcrypt-hashed. Changing or resetting a password, or disabling a
  user, ends that user's other sessions immediately.
* Failed sign-ins are counted per account in the database (10 in 15 minutes locks
  that account for the window), so the limit holds across server instances.
* Credits change by compare-and-set in whole cents; a run's charge is refunded
  automatically if the run cannot start, and stopping a run refunds unscored
  records exactly once.
* Uploads are capped by size (4 MB) and row count (20,000). Results expire after
  `DATA_RETENTION_DAYS`. Security headers (CSP, frame blocking) are set in `vercel.json`.

## Admin tasks

* Add credits: *Admin → Clients & users → Credits*, or issue an invoice and mark it
  paid (adds the amount to credits).
* Stuck or failed run: *Admin → All runs → Resume*.
* Reset an admin from the command line: `npm run seed:admin -- email@x.com "new-password"`.
* Records that error during a run stay charged until an admin resumes the run (resume retries them).
* Move old client accounts and balances: `scripts/migrate-legacy.js` (passwords are
  not copied; each user gets a temporary one).

Data retention: jobs and records delete themselves after `DATA_RETENTION_DAYS`
(default 90) through a MongoDB TTL index.
