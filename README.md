# Kuviyam platform (Phase 1)

Tamil and English giving platform for Kuviyam (kuviyam.org): verified charities, NGOs, diaspora and community groups post projects and needs, take donations and student sponsorships, and publish monthly spending reports with receipts.

## What's in Phase 1

- **Public site:** home, projects (search and filters), project pages, partners, partner pages, student sponsorship, transparency reports with receipts. English / தமிழ் switch on every page.
- **Donations:** one-off and monthly, Gift Aid flag, optional 5% tip, anonymous option, receipts. Payments run in **test mode** until the DPayments merchant account is ready (`src/payments.js`).
- **Join as a partner:** account, then an application with registration, constitution, accounts and ID documents (PDF/JPG/PNG/WebP, 5 MB each, checked by content).
- **Partner dashboard:** overview, bilingual projects, monthly reports with expense lines and receipt uploads, submit for review, students (first name only).
- **Community hub:** partner feed with photos and short videos, likes, comments and reporting; events with approval and RSVP; obituaries and memorials with approval, candles, condolences and giving in memory.
- **Members:** free sign-up with email; Silver and Gold paid memberships (prices set by admins, test payments until DPayments is live). Profiles with photo, home town and bio, follow, people search, member posts with photos (Gold: videos), likes and comments, one-to-one messages, notifications, blocking.
- **Admin:** review queue (applications with documents, monthly reports), approve or send back, partners list with suspend/reinstate, donations list.

## Run it

Needs Node.js 22.13 or newer. No packages to install: the database is the built-in `node:sqlite`.

```bash
npm start          # http://localhost:3000
npm test           # end-to-end smoke test on a temporary database
```

## Settings (environment variables)

| Variable | What it does |
| --- | --- |
| `PORT` | Port to listen on (default 3000) |
| `DATA_DIR` | Folder for the database, kept outside the app so deploys never wipe it (default `~/kuviyam-data`) |
| `SETUP_CODE` | One-time code that lets you create the first admin at `/setup`. The page closes once an admin exists. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | On start, creates this admin (or makes that account admin and resets its password). Password 12+ characters. Remove both once you can sign in. |
| `PAYMENT_PROVIDER` | `test` (default). `dpayments` once the integration is built. |
| `SEED_DEMO` | `1` loads the sample partners, projects and reports on an empty database |
| `DEMO_MODE` | `1` shows the staging banner, hides the site from search engines and shows the demo partner login |
| `DEMO_PASSWORD` | Password for the demo partner account `partner@demo.kuviyam.org` (demo data only) |
| `RATE_LKR_PER_GBP` | Example exchange rate for display (default 385) |

## Deploying on Hostinger

Node.js app, entry file `server.js`, start command `npm start`, Node 22. Set the variables above in hPanel. Back up `DATA_DIR/kuviyam.db`.

## Not in Phase 1 yet

Live DPayments payments, email sending (Resend), password reset, and moving to PostgreSQL. See the build plan.
