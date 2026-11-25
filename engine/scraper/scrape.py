#!/usr/bin/env python3
"""Pull live jobs from public ATS job-board APIs and keep the FDE-type roles.

Stdlib only (runs on the system Python 3.9). No API keys needed.

  python3 scraper/scrape.py                      # every seed in seeds/companies.csv
  python3 scraper/scrape.py --slugs glean        # one-off check (merged into the outputs)
  .venv/bin/python -m scraper.scrape --slugs glean

Seeds: seeds/companies.csv (slug,fetch_slug,name,ats_override,industries,source,notes). `ats_override` is blank
(try every ATS), an ATS name, or `none` (never probe). `--slugs` also accepts `slug`, `slug@ats`,
`slug=fetch_slug@ats` and `slug@none`; a bare slug picks up its CSV row.
Confirmed manual roles: seeds/manual_jobs.json (see seeds/README.md).
ATS names: greenhouse, lever, lever-eu, ashby, workable.

  python3 scraper/scrape.py --describe-all       # also backfill every missing Greenhouse description
  python3 scraper/scrape.py --dry-run            # fetch and summarise, write nothing
  python3 scraper/scrape.py --report             # print database counts only, no fetching

Writes data/fde.db (postings, roles with first/last seen and closure), data/jobs.json (one entry per
live role), data/boards.json (the ATS cache, merged, never replaced) and out/last_run.json.
"""
import argparse
import json
import os
import re
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scraper import ats as ats_mod  # noqa: E402
from scraper import db  # noqa: E402
from scraper import descriptions  # noqa: E402
from scraper import industries  # noqa: E402

# Environment overrides let scripts/scrape_and_tag.sh run against a throwaway database in tests.
_DATA = Path(os.environ.get("FDE_DATA_DIR") or ROOT / "data")
_OUT = Path(os.environ.get("FDE_OUT_DIR") or ROOT / "out")
SEEDS = Path(os.environ.get("FDE_SEEDS") or ROOT / "seeds" / "companies.csv")
# Sits next to whichever seed file is in play, so pointing FDE_SEEDS at a temporary CSV moves both.
# Pinned to the repo it broke the test suite the moment a real manual role existed: the tests ran with
# an empty seed CSV but the real manual_jobs.json, so every run failed on a company it could not find.
MANUAL_JOBS = Path(os.environ.get("FDE_MANUAL_JOBS") or SEEDS.parent / "manual_jobs.json")
OUT_JOBS = _DATA / "jobs.json"
OUT_BOARDS = _DATA / "boards.json"
OUT_RUN = _OUT / "last_run.json"
OUT_DB = Path(os.environ.get("FDE_DB") or _DATA / "fde.db")
DESCRIBE_CAP = 300

# Tiers: "fde" is the core product, "deployment" is the same job under another name,
# "adjacent" only counts when the company is an AI/services startup (it is noisy on LinkedIn).
TIERS = [
    ("fde", re.compile(r"forward[\s-]*deploy", re.I)),
    # "deployments" plural is the same job: Langdock's "Enterprise Deployments Engineer" matched
    # nothing until 24 Sep 2026 purely because the pattern was singular.
    ("deployment", re.compile(r"\bdeployments?\s+(strategist|lead|engineer|manager|specialist|architect)|\bagent\s+deployment", re.I)),
    # "associate" is the junior rung of the same job: Plan Lab's Delivery Associate reports to a
    # Delivery Lead and has a path into solving customer problems on the platform. Measured before
    # adding it: of 672 distinct stored titles, exactly 1 matches and it already had a tier, so this
    # widens the net without adding noise. Relevance still has to judge each one on its own evidence.
    ("adjacent", re.compile(r"\b(delivery|implementation)\s+(lead|manager|engineer|consultant|associate)|\bsolutions?\s+(engineer|architect)\b|\bapplied\s+ai\s+engineer", re.I)),
]
EXCLUDE = re.compile(r"recruit|talent|sales\s+development|account\s+executive", re.I)
# Placeholder and draft listings companies leave on their live board. Parloa published
# "TEST - Forward Deployed Engineer" on 19 Sep 2026 and it reached the site.
# Deliberately narrow: a bare leading "Test" is not enough, because "Test Engineer, Deployment" is a
# real job. It takes a bracket, a separator, or a word no real title starts with.
PLACEHOLDER = re.compile(
    r"^\s*[\[(]\s*(test|testing|draft|sample|example|dummy|template|wip|internal)\b"      # [TEST] ...
    r"|^\s*(test|testing|xxx+|zzz+)\s*[-\u2013\u2014:|]"                                  # TEST - ...
    r"|^\s*(draft|dummy|sample|template|example|placeholder|ignore)\b"                      # DRAFT ...
    r"|\b(do\s*not\s*(apply|use)|test\s*(job|post|posting|role|req|requisition))\b",      # ... (do not apply)
    re.I,
)

ATS_HOST = {
    "greenhouse": "boards-api.greenhouse.io",
    "lever": "api.lever.co",
    "lever-eu": "api.eu.lever.co",
    "ashby": "api.ashbyhq.com",
    "workable": "apply.workable.com",
}
NO_BOARD_TTL_DAYS = 7  # with --skip-recent-dead, a seed with no board on any ATS is not re-probed for this long
HOST_WORKERS = {"api.lever.co": 1, "api.eu.lever.co": 1, "apply.workable.com": 1,
                "boards-api.greenhouse.io": 8, "api.ashbyhq.com": 8}


def tier_of(title):
    title = (title or "").strip()
    if EXCLUDE.search(title) or PLACEHOLDER.search(title):
        return None
    for name, rx in TIERS:
        if rx.search(title):
            return name
    return None


def load_json(path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


class HostRunner:
    """Runs (ats, fetch_slug) tasks on one small executor per host, so a slow host never starves the rest."""

    def __init__(self):
        self.pools = {h: ThreadPoolExecutor(n, thread_name_prefix=h) for h, n in HOST_WORKERS.items()}

    def __call__(self, tasks, get):
        futs = [self.pools[ATS_HOST[a]].submit(ats_mod._try, a, fs, get, lambda fn, s, g: fn(s, get=g))
                for a, fs in tasks]
        return [f.result() for f in futs]

    def close(self):
        for p in self.pools.values():
            p.shutdown()


def summarise_failed(failed):
    by_host = Counter(f["host"] for f in failed)
    head = f"failed: {len(failed)}"
    if by_host:
        head += " (" + ", ".join(f"{h}: {n}" for h, n in sorted(by_host.items())) + ")"
    lines = [head]
    for f in failed:
        status = f["status"] if f["status"] else "network error"
        lines.append(f"  {f['slug']}  {f['host']}  {status}")
    return lines


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--slugs", nargs="*", help="seed lines to run instead of the seed file (override syntax allowed)")
    p.add_argument("--workers", type=int, default=32)
    p.add_argument("--skip-recent-dead", action="store_true",
                   help=f"opt-in: do not re-probe seeds that had no board on any ATS in the last {NO_BOARD_TTL_DAYS} days "
                        "(saves ~5 requests per dead seed; the default full run probes every seed)")
    p.add_argument("--retry-wait", type=int, default=60,
                   help="seconds to wait before one more pass over slugs whose fetch failed (0 disables)")
    p.add_argument("--dry-run", action="store_true", help="fetch and print the summary, write nothing")
    p.add_argument("--report", action="store_true", help="print database counts and exit (no fetching)")
    p.add_argument("--retag", action="store_true", help="re-tag every role from stored titles and descriptions and exit")
    p.add_argument("--tag-report", action="store_true", help="print industry tagging counts and exit (no fetching)")
    p.add_argument("--describe-all", action="store_true",
                   help=f"fetch every missing Greenhouse description (default cap {DESCRIBE_CAP} per run)")
    args = p.parse_args(argv)
    if args.report:
        return report()
    if args.retag:
        return retag()
    if args.tag_report:
        return tag_report()
    if os.environ.get("FDE_FAKE_FAIL") == "1":
        # Used by the M8 kill test: die before anything, including last_run.json, is written.
        print("FDE_FAKE_FAIL=1: exiting before the scrape", file=sys.stderr)
        return 1
    started = ats_mod.utc_now()

    seeds = ats_mod.load_seeds_csv(SEEDS.read_text())
    if args.slugs:
        # A bare slug on the command line picks up its override from the seed file.
        by_slug = {e["slug"]: e for e in seeds}
        entries = []
        for s in args.slugs:
            e = ats_mod.parse_seed_line(s)
            if e is None:
                continue
            if "=" not in s and "@" not in s and e["slug"] in by_slug:
                e = by_slug[e["slug"]]
            entries.append(e)
        entries = list({e["slug"]: e for e in entries}.values())
    else:
        entries = seeds

    boards_doc = load_json(OUT_BOARDS, {})
    cache = boards_doc.get("boards", {})
    no_board = boards_doc.get("no_board", {})  # slug -> UTC time every ATS said there is no board
    not_rechecked = []
    if not args.slugs and args.skip_recent_dead:
        # Opt-in only (PLAN.md M1a says a full run tries every seed); --slugs always probes.
        cutoff = (datetime.now(timezone.utc) - timedelta(days=NO_BOARD_TTL_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
        not_rechecked = sorted(e["slug"] for e in entries
                               if e["slug"] not in cache and e.get("ats") != "none"
                               and no_board.get(e["slug"], "") >= cutoff)
        entries = [e for e in entries if e["slug"] not in not_rechecked]

    runner = HostRunner()
    retried = []
    try:
        with ThreadPoolExecutor(args.workers) as ex:
            scrape = lambda e: ats_mod.scrape_slug(e, cache.get(e["slug"]), runner=runner)  # noqa: E731
            results = list(ex.map(scrape, entries))
            again = [i for i, r in enumerate(results)
                     if any(not ats_mod.LIMITS.get(f["host"], ats_mod.DEFAULT_LIMIT).closed for f in r["failed"])]
            if again and args.retry_wait > 0:
                # Rate limits on Workable outlast a 2/4/8s backoff; one slower pass at the end recovers them.
                retried = [results[i]["slug"] for i in again]
                print(f"retrying {len(again)} slugs with failed fetches in {args.retry_wait}s: {' '.join(retried)}",
                      file=sys.stderr)
                time.sleep(args.retry_wait)
                for i, r in zip(again, ex.map(scrape, [entries[i] for i in again])):
                    results[i] = r
    finally:
        runner.close()

    failed = []
    for r in results:
        slug = r["slug"]
        failed.extend(r["failed"])
        if r["board"]:
            cache[slug] = r["board"]
            no_board.pop(slug, None)
        elif r["skipped"] or not r["failed"]:
            # @none seeds, and slugs with no board on any host (every host answered), leave the cache.
            cache.pop(slug, None)
            if r["skipped"]:
                no_board.pop(slug, None)
            else:
                no_board[slug] = ats_mod.utc_now()
        # A slug whose fetch failed keeps its previous cache entry and previous jobs.

    finished = ats_mod.utc_now()
    described = None
    db_counts = None
    refused_close = False
    if not args.dry_run:
        conn = db.connect(OUT_DB)
        try:
            ts = db.now()
            db.upsert_seeds(conn, seeds, ts)
            for r in results:
                apply_result(conn, r, ts)
            db.record_manual_jobs(conn, load_manual_jobs({e['slug'] for e in seeds}), tier_of, ts)
            if not args.slugs:
                probed = {e["slug"] for e in seeds if e.get("ats") != "none"}
                stored = {r[0] for r in conn.execute(
                    "SELECT DISTINCT company_slug FROM postings WHERE COALESCE(source, 'ats') = 'ats' "
                    "AND present_last_run = 1")}
                dropping = stored - probed
                if stored and len(dropping) > max(3, len(stored) // 2):
                    # A truncated or empty companies.csv must not close the whole board.
                    print(f"refusing to close roles for {len(dropping)} of {len(stored)} companies missing from "
                          f"{SEEDS.name}; check the seed file", file=sys.stderr)
                    refused_close = True
                else:
                    for slug in db.close_unseeded(conn, probed, tier_of, ts):
                        print(f"closed roles of {slug}: no longer probed (removed from companies.csv or set to none)")
            conn.commit()
            described = descriptions.fetch_missing_greenhouse(
                conn, ats_mod.fetch_json, cap=None if args.describe_all else DESCRIBE_CAP)
            # Roles were tagged before Greenhouse descriptions arrived; tag again so a scrape and --retag agree.
            db.retag_all(conn)
            live = db.live_roles(conn)
            db_counts = db.counts(conn)
        finally:
            conn.close()
        OUT_JOBS.parent.mkdir(exist_ok=True)
        OUT_JOBS.write_text(json.dumps({"scraped_at": finished, "roles": live}, indent=2))
        boards_doc["scraped_at"] = finished
        boards_doc["boards"] = dict(sorted(cache.items()))
        boards_doc["no_board"] = dict(sorted(no_board.items()))
        OUT_BOARDS.write_text(json.dumps(boards_doc, indent=2))

    run_boards = [r for r in results if r["board"]]
    open_roles = sum(r["board"]["open_roles"] for r in run_boards)
    run_matched = sum(1 for r in run_boards for j in r["jobs"] if tier_of(j["title"]))
    run_doc = {
        "postings": db_counts["postings"] if not args.dry_run else None,
        "roles": db_counts["roles"] if not args.dry_run else None,
        "live_roles": db_counts["live_roles"] if not args.dry_run else None,
        "failed_companies": sorted({f["slug"] for f in failed}),
        "refused_close": refused_close,
        "slugs_tried": len([r for r in results if not r["skipped"]]),
        "skipped_none": sorted(r["slug"] for r in results if r["skipped"]),
        "no_board_not_rechecked": not_rechecked,
        "boards_found": len(run_boards),
        "empty_boards": sorted(r["slug"] for r in run_boards if not r["board"]["open_roles"]),
        "open_roles": open_roles,
        "matched": run_matched,
        "retried": retried,
        "failed": failed,
        "started": started,
        "finished": finished,
    }
    if not args.dry_run:
        OUT_RUN.parent.mkdir(exist_ok=True)
        OUT_RUN.write_text(json.dumps(run_doc, indent=2))

    tiers = Counter(tier_of(j["title"]) for r in run_boards for j in r["jobs"])
    empty = sum(1 for r in run_boards if not r["board"]["open_roles"])
    skipped = sum(1 for r in results if r["skipped"])
    print(f"slugs tried: {len(results) - skipped}  boards found: {len(run_boards)}  "
          f"(empty: {empty}, @none skipped: {skipped})  open roles on them: {open_roles}")
    print(f"matched: {run_matched}  " + "  ".join(f"{k}={tiers.get(k, 0)}" for k, _ in TIERS))
    by_co = Counter(r["slug"] for r in run_boards for j in r["jobs"] if tier_of(j["title"]) in ("fde", "deployment"))
    print("top companies (fde + deployment):", ", ".join(f"{c} {n}" for c, n in by_co.most_common(15)))
    for line in summarise_failed(failed):
        print(line)
    missed = [r["slug"] for r in results if not r["board"] and not r["skipped"] and not r["failed"]]
    if missed:
        print(f"no board found for {len(missed)} slugs: {' '.join(sorted(missed))}", file=sys.stderr)
    if not_rechecked:
        print(f"not re-probed (--skip-recent-dead: no board on any ATS in the last {NO_BOARD_TTL_DAYS} days): "
              f"{len(not_rechecked)}")
    print(f"cache: {len(cache)} boards in {OUT_BOARDS.name}")
    if args.dry_run:
        print("dry run: nothing written")
    else:
        if described is not None:
            print(f"descriptions fetched: {described[0]}  failed: {described[1]}")
        print_counts()


MANUAL_KEYS = ("company_slug", "title", "location", "remote", "url", "industries", "added", "confirmed_by")
# "description" is optional but strongly wanted: without the advert text the relevance
# classifier has no evidence and rules the role off the board. See scraper/db.record_manual_jobs.


def load_manual_jobs(known_slugs=None):
    if not MANUAL_JOBS.exists():
        return []
    jobs = json.loads(MANUAL_JOBS.read_text())
    for j in jobs:
        missing = [k for k in MANUAL_KEYS if k not in j]
        if missing or not j.get("company_slug") or not j.get("title") or not j.get("confirmed_by"):
            raise ValueError(f"manual_jobs.json entry needs {list(MANUAL_KEYS)} (missing {missing}): {j}")
        if known_slugs is not None and j["company_slug"] not in known_slugs:
            raise ValueError(f"manual_jobs.json: add {j['company_slug']!r} to companies.csv first")
    return jobs


def apply_result(conn, r, ts):
    """Store one scrape_slug result. Returns what happened: stored, closed, kept or skipped."""
    if r["skipped"]:
        return "skipped"
    if r["board"]:
        db.record_company_run(conn, r["slug"], r["board"]["fetch_slug"], r["board"]["ats"], r["jobs"], tier_of, ts)
        return "stored"
    row = conn.execute("SELECT ats FROM companies WHERE slug = ?", (r["slug"],)).fetchone()
    if r["failed"] or row is None:
        db.record_company_failed(conn, r["slug"], None, None, ts)
        return "kept"
    if row[0] == "workable":
        # Workable answers an empty account for boards that exist, so "no board" there proves nothing.
        db.record_company_failed(conn, r["slug"], None, None, ts)
        return "kept"
    # Every host answered and none has a board: what we stored for it has closed.
    db.record_company_run(conn, r["slug"], None, None, [], tier_of, ts)
    return "closed"


def print_counts():
    conn = db.connect(OUT_DB)
    try:
        c = db.counts(conn)
    finally:
        conn.close()
    print(f"db: postings {c['postings']}  roles {c['roles']}  live {c['live_roles']}  closed {c['closed_roles']}  "
          f"with description {c['with_description']}")
    return c


def keyword_baseline(conn):
    rows = conn.execute("SELECT title_norm FROM roles WHERE status = 'live'").fetchall()
    hits = sum(1 for (t,) in rows if industries.industries_in(t))
    return f"title keyword baseline: {hits} of {len(rows)} live roles have an industry keyword in the title"


def _edit_distance(a, b, limit=3):
    if abs(len(a) - len(b)) >= limit:
        return limit
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        if min(cur) >= limit:
            return limit
        prev = cur
    return prev[-1]


def near_duplicates(conn, top=10):
    by_co = {}
    for slug, title in conn.execute("SELECT company_slug, title_norm FROM roles WHERE status = 'live'"):
        by_co.setdefault(slug, []).append(title)
    pairs = []
    for slug, titles in by_co.items():
        titles = sorted(set(titles))
        for i, a in enumerate(titles):
            for b in titles[i + 1:]:
                d = _edit_distance(a.lower(), b.lower())
                if d < 3:
                    pairs.append((d, slug, a, b))
    return sorted(pairs)[:top]


def retag():
    if not OUT_DB.exists():
        print(f"no database at {OUT_DB}; run the scraper first")
        return 1
    conn = db.connect(OUT_DB)
    try:
        n = db.retag_all(conn)
        live = db.live_roles(conn)
    finally:
        conn.close()
    doc = load_json(OUT_JOBS, {})
    OUT_JOBS.write_text(json.dumps({"scraped_at": doc.get("scraped_at"), "roles": live}, indent=2))
    print(f"retagged {n} roles")
    return 0


def tag_report():
    if not OUT_DB.exists():
        print(f"no database at {OUT_DB}; run the scraper first")
        return 1
    conn = db.connect(OUT_DB)
    try:
        r = db.tag_report(conn)
    finally:
        conn.close()
    total = r["roles"] or 1
    print(f"roles total: {r['roles']}")
    print(f"tagged by title: {r['title']}")
    print(f"tagged by description: {r['description']}")
    if r["manual"]:
        print(f"tagged by hand (manual_jobs.json): {r['manual']}")
    print(f"untagged: {r['untagged']}")
    print(f"share tagged by title: {100 * r['title'] / total:.1f}%")
    print("per industry:")
    for ind in industries.TAXONOMY:
        if r["per_industry"].get(ind):
            print(f"  {ind}: {r['per_industry'][ind]}")
    print(f"top {len(r['untagged_top'])} untagged title_norms:")
    for title, n in r["untagged_top"]:
        print(f"  {n}  {title}")
    return 0


def report():
    if not OUT_DB.exists():
        print(f"no database at {OUT_DB}; run the scraper first")
        return 1
    c = print_counts()
    print("live roles per tier: " + "  ".join(f"{k}={v}" for k, v in sorted(c["by_tier"].items())))
    conn = db.connect(OUT_DB)
    try:
        print(keyword_baseline(conn))
        dups = near_duplicates(conn)
    finally:
        conn.close()
    print(f"near-duplicate titles within a company (edit distance < 3): {len(dups)} shown")
    for d, slug, a, b in dups:
        print(f"  {slug}: {a!r} ~ {b!r} ({d})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
