"""Scrape every company board and write public/data/roles.json. Runs on a schedule in CI.

  python3 engine/refresh.py

CI has no database between runs, so two committed files carry the state a scrape cannot rebuild:
- `engine/first_seen.json`: when each role and posting was first seen.
- `engine/history.json` (M11): which roles were open, which closed and when, and when we started watching
  each company. Without it a closed role simply vanished, and nothing could say how fast a company hires.
Everything else (roles, tags, relevance, signals) is derived from the scrape each time.
"""
import csv
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DATA = ROOT / "data"
FIRST_SEEN = ROOT / "first_seen.json"
HISTORY = ROOT / "history.json"
OUT = REPO / "public" / "data" / "roles.json"

os.environ.setdefault("FDE_DATA_DIR", str(DATA))
os.environ.setdefault("FDE_OUT_DIR", str(ROOT / "out"))
os.environ.setdefault("FDE_SEEDS", str(ROOT / "seeds" / "companies.csv"))

from app import queries  # noqa: E402
from scraper import db as store  # noqa: E402
from scraper import scrape  # noqa: E402
from scraper import fde_likely, founders, funding, news, pitch, signals  # noqa: E402
from scraper.industries import TAXONOMY  # noqa: E402


LOGO_DIR = None  # set by the caller; the file name carries the extension the site should request


def logo_for(slug, logo_dir):
    """The logo file for a company, or None. Extensions vary: the data carries the real name."""
    if not logo_dir or not logo_dir.exists():
        return None
    for ext in (".svg", ".png", ".jpg", ".ico"):
        if (logo_dir / f"{slug}{ext}").exists():
            return f"/logos/{slug}{ext}"
    return None


def load_first_seen():
    if not FIRST_SEEN.exists():
        return {"roles": {}, "postings": {}}
    doc = json.loads(FIRST_SEEN.read_text())
    return {"roles": doc.get("roles", {}), "postings": doc.get("postings", {})}


def apply_first_seen(conn, known):
    """Put back the dates this run could not know, then rebuild the roles that changed."""
    restored = 0
    for url, seen in known["postings"].items():
        restored += conn.execute("UPDATE postings SET first_seen = ? WHERE url = ? AND first_seen > ?",
                                 (seen, url, seen)).rowcount
    for key, seen in known["roles"].items():
        conn.execute("UPDATE roles SET first_seen = ? WHERE role_key = ? AND first_seen > ?", (seen, key, seen))
    conn.commit()
    return restored


def save_first_seen(conn):
    doc = {
        "roles": {k: v for k, v in conn.execute("SELECT role_key, first_seen FROM roles ORDER BY role_key")},
        "postings": {k: v for k, v in conn.execute("SELECT url, first_seen FROM postings ORDER BY url")},
    }
    FIRST_SEEN.write_text(json.dumps(doc, indent=0, sort_keys=True))
    return len(doc["roles"]), len(doc["postings"])


def load_history():
    if not HISTORY.exists():
        return signals.empty_history()
    return {**signals.empty_history(), **json.loads(HISTORY.read_text())}


def save_history(history):
    HISTORY.write_text(json.dumps(history, indent=0, sort_keys=True))


def _about(db_path, slug):
    """The longest advert stored for a company, which is the best description of it we own."""
    conn = store.connect(db_path)
    try:
        row = conn.execute("SELECT description FROM postings WHERE company_slug=? AND description IS NOT NULL "
                           "ORDER BY length(description) DESC LIMIT 1", (slug,)).fetchone()
        return (row[0] or "")[:4000] if row else ""
    finally:
        conn.close()


def _news_cache():
    """Announcements per company, or {} before scripts/fetch_news.py has ever run."""
    try:
        return json.loads((ROOT / "news.json").read_text()).get("companies", {})
    except (OSError, ValueError):
        return {}


def funding_for(seeds_dir, today=None):
    """Latest public round per company, or {} before seeds/funding.csv exists."""
    path, inv = Path(seeds_dir) / "funding.csv", Path(seeds_dir) / "investors.csv"
    if not path.exists():
        return {}
    rows, rejected = funding.load(path)
    for slug, reason in rejected:
        print(f"funding: skipped {slug}: {reason}", file=sys.stderr)
    return funding.by_company(rows, funding.load_investors(inv) if inv.exists() else {}, today=today)


def founders_for(seeds_dir):
    """One named founder per company, or {} before seeds/founders.csv has rows."""
    path = Path(seeds_dir) / "founders.csv"
    if not path.exists():
        return {}
    seeds = Path(seeds_dir) / "companies.csv"
    own = {}
    if seeds.exists():
        with open(seeds, newline="") as f:
            own = {r["slug"]: r.get("domain") or "" for r in csv.DictReader(f)}
    rows, rejected = founders.load(path, own_domains=own)
    for slug, reason in rejected:
        print(f"founders: skipped {slug}: {reason}", file=sys.stderr)
    return founders.by_company(rows)


def existing_roles(path):
    """How many roles the published file already carries, or 0 when there is nothing readable there."""
    try:
        return int(json.loads(path.read_text())["counts"]["roles"])
    except (OSError, ValueError, KeyError, TypeError):
        return 0


def export(db_path, result):
    roles = queries.list_roles(db_path, related=True, limit=10000)
    companies = queries.list_companies(db_path)
    conn = store.connect(db_path)
    try:
        generated = conn.execute("SELECT max(last_seen) FROM roles").fetchone()[0]
    finally:
        conn.close()
    out = [{
        "id": r["role_key"], "title": r["title"], "company": r["company_name"], "companySlug": r["company_slug"],
        "locations": r["locations"], "country": r["country"], "remote": r["remote"],
        "url": (r["urls"] or [None])[0], "industries": r["industries"], "industrySource": r["industry_source"],
        "companyIndustries": r["company_industries"], "relevance": r["relevance"],
        "relevanceReason": r["relevance_reason"], "flags": r["flags"], "team": r["team"],
        "firstSeen": r["first_seen"],
        "isNew": r["is_new"],
    } for r in roles]
    doc = signals.attach({
        "generated": generated,
        "counts": {"roles": len(out), "core": sum(1 for r in out if r["relevance"] == "core"),
                   "related": sum(1 for r in out if r["relevance"] == "related"), "companies": len(companies)},
        "industries": [i for i in TAXONOMY if i != "horizontal"],
        "roles": out,
        "companies": [{"slug": c["slug"], "name": c["name"], "industries": c["industries"],
                       "liveRoles": c["live_roles"], "board": c["ats"],
                       # Watchlist companies are here for what they will post, not what they have posted.
                       "watching": (c.get("source") or "").startswith("watch_"),
                       "logo": logo_for(c["slug"], REPO / "public" / "logos")} for c in companies],
    }, result)
    funding.attach(doc, funding_for(ROOT / "seeds", today=(generated or "")[:10] or None))
    # Lets the Monday briefing rank a week of funding rounds by who needs people on the ground,
    # rather than by who raised the most. See scraper/fde_likely.py for how it is scored.
    hiring = {r["companySlug"] for r in doc["roles"] if r.get("relevance") == "core"}
    fde_likely.attach(doc, lambda slug: _about(db_path, slug), hiring)
    # Announcements per company, read from the committed cache. CI does not fetch 200 feeds every
    # two hours: scripts/fetch_news.py refreshes engine/news.json and it is committed like any seed.
    news.attach(doc, _news_cache())
    # One line on what each company does, in its own words. See scraper/pitch.py.
    pitch.attach(doc, lambda slug: _about(db_path, slug))
    founders.attach(doc, founders_for(ROOT / "seeds"))
    # A run that comes back with nothing is a broken run, not an empty job market. Publishing it would
    # blank the live board until the next cron three hours later, so the old file stays.
    if not out and existing_roles(OUT):
        raise SystemExit(f"refusing to publish 0 roles over the {existing_roles(OUT)} already in {OUT.name}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=2))
    return doc["counts"]


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    known = load_first_seen()
    history = load_history()
    # --describe-all: CI starts from an empty database every run, so the default cap of 300 Greenhouse
    # descriptions meant the same ~174 postings never had one, and were tagged and judged on title alone.
    code = scrape.main(["--retry-wait", "60", "--describe-all"])
    if code not in (0, None):
        print(f"scrape exited {code}", file=sys.stderr)
        return code
    db_path = os.environ.get("FDE_DB") or DATA / "fde.db"
    conn = store.connect(db_path)
    try:
        restored = apply_first_seen(conn, known)
        store.retag_all(conn)
        roles, postings = save_first_seen(conn)
        ts = store.now()
        live = signals.db_live(conn)
        attempted, fetched_ok = signals.db_fetch_state(conn)
        change = signals.advance(history, live, attempted, fetched_ok, ts)
        closed = [dict(v, role_key=k) for k, v in history["closed"].items()]
        result = signals.compute(live, closed, history["watching"], today=ts)
    finally:
        conn.close()
    # history.json is written only after the export succeeds: a refused export must not advance the archive.
    counts = export(db_path, result)
    save_history(history)
    print(f"restored first_seen on {restored} postings; state now {roles} roles, {postings} postings")
    print(f"history: {change}; {len(history['closed'])} closed on record, {len(history['watching'])} companies watched")
    if change["suspect"]:
        print(f"WARNING: {change['suspect']} roles vanished in one run; not recorded as closures", file=sys.stderr)
    print(f"wrote {OUT.relative_to(REPO)}: {counts}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
