# engine

A copy of the scraper from `fde-board`, so GitHub Actions can run it here every 3 hours.

**Do not edit these files by hand.** Edit them in `fde-board`, run its tests, then run
`bash scripts/sync_engine.sh` there and commit the result here.

- `refresh.py` scrapes every company in `seeds/companies.csv`, restores first-seen dates from
  `first_seen.json`, and writes `public/data/roles.json` for the site.
- `first_seen.json` is the only state CI cannot rebuild: when each role and posting was first seen.
- `data/` and `out/` are scratch, ignored by git.
