# Forward Deployed

A job board for forward deployed engineers, the people who go on site and make software work inside a customer's business. Live at [forwarddeployed.work](https://forwarddeployed.work).

Most boards bury these roles among generic engineering jobs, and none let you filter by the industry you already know. This one does: 811 roles at 147 companies as of 25 Nov 2026 (254 companies tracked), each tagged by the sector the company sells into.

## What it does

- **Roles**, filtered by industry, country and remote, with core FDE roles shown by default and related ones (customer-facing, but without a deployment title) a toggle away.
- **Companies**, with how many roles each has open, what opened and closed in the last 30 days, and who led its latest round.
- **A weekly briefing email** of new roles and recently funded companies.

## How it works

- **`engine/`** (Python, standard library only) pulls live jobs from the public job-board APIs of Ashby, Greenhouse and Lever for every company in `engine/seeds/companies.csv`, plus a few roles added by hand from company sites. It keeps the FDE-type roles, tags relevance and industry, and writes `public/data/roles.json`.
- It remembers when each role was first seen (`engine/first_seen.json`), so it can show what's new and what has been open for months.
- Funding comes from public sources only, each row linked to the page it was read from: company announcements, press releases and press coverage. Never paid data aggregators.
- **The site** is a static front end (TanStack Start, Tailwind) that reads that one JSON file. **`api/`** holds two small Vercel functions for briefing sign-ups and sends, through Resend.

In production a scheduled job reruns the engine every couple of hours and commits the new data. This repo is a snapshot of the code and data, without that job.

## Run it locally

```
npm install
npm run dev
```

The site runs on the data already in `public/data/roles.json`. To refresh it:

```
python3 engine/refresh.py
```
