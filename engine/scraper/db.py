"""SQLite store (data/fde.db): companies, roles and postings, with first/last seen and closure.

A posting is one ATS listing (one URL). A role is the same job at one company across cities:
postings grouped by `role_key`. Stdlib only.
"""
import json
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone

from scraper import descriptions, industries, normalise, relevance as relevance_mod

SCHEMA = """
CREATE TABLE IF NOT EXISTS companies (
    slug TEXT PRIMARY KEY,
    fetch_slug TEXT,
    name TEXT,
    ats TEXT,
    industries TEXT,
    source TEXT,
    notes TEXT,
    first_seen TEXT,
    last_seen TEXT,
    last_fetch_ok INTEGER
);
CREATE TABLE IF NOT EXISTS roles (
    role_key TEXT PRIMARY KEY,
    company_slug TEXT REFERENCES companies(slug),
    title_display TEXT,
    title_norm TEXT,
    tier TEXT,
    locations TEXT,
    country TEXT,
    remote INTEGER,
    urls TEXT,
    industries TEXT,
    industry_source TEXT,
    status TEXT DEFAULT 'live',
    listing_state TEXT DEFAULT 'scraped',
    relevance TEXT,
    relevance_reason TEXT,
    flags TEXT,
    posted TEXT,
    team TEXT,
    first_seen TEXT,
    last_seen TEXT,
    closed_at TEXT
);
CREATE TABLE IF NOT EXISTS postings (
    url TEXT PRIMARY KEY,
    role_key TEXT REFERENCES roles(role_key),
    company_slug TEXT,
    title TEXT,
    location TEXT,
    other_locations TEXT,
    country TEXT,
    remote INTEGER,
    updated TEXT,
    posted TEXT,
    team TEXT,
    description TEXT,
    first_seen TEXT,
    last_seen TEXT,
    present_last_run INTEGER,
    source TEXT DEFAULT 'ats'
);
CREATE TABLE IF NOT EXISTS waitlist (
    id INTEGER PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    linkedin_url TEXT,
    tiers TEXT,
    industries TEXT,
    years INTEGER,
    location TEXT,
    remote_pref TEXT,
    note TEXT,
    consented_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    source TEXT
);
CREATE INDEX IF NOT EXISTS postings_company ON postings(company_slug);
CREATE INDEX IF NOT EXISTS roles_company ON roles(company_slug);
"""


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def connect(path):
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(postings)")}
    if "source" not in cols:
        # Databases created before M3a: postings came only from ATS boards.
        conn.execute("ALTER TABLE postings ADD COLUMN source TEXT DEFAULT 'ats'")
    if "posted" not in cols:  # added in M11: the day the ATS says the listing was published
        conn.execute("ALTER TABLE postings ADD COLUMN posted TEXT")
    if "team" not in cols:  # added in M12: the team or department the listing sits under
        conn.execute("ALTER TABLE postings ADD COLUMN team TEXT")
    role_cols = {r[1] for r in conn.execute("PRAGMA table_info(roles)")}
    for col in ("relevance", "relevance_reason", "flags", "posted", "team"):  # M9, posted M11, team M12
        if col not in role_cols:
            conn.execute(f"ALTER TABLE roles ADD COLUMN {col} TEXT")
    return conn


# A listing's publish day never moves later: a run where the ATS omits it, or reports a later one, keeps ours.
EARLIEST_POSTED = ("CASE WHEN postings.posted IS NULL THEN excluded.posted WHEN excluded.posted IS NULL "
                   "THEN postings.posted ELSE min(postings.posted, excluded.posted) END")


def _bool_int(v):
    return None if v is None else int(bool(v))


def _posting_url(slug, job):
    if job.get("url"):
        return job["url"]
    # No URL from the ATS: a stable synthetic key so the posting still dedupes run to run.
    return f"nourl:{slug}:{normalise.slugify(job.get('title'))}:{normalise.slugify(job.get('location'))}"


def upsert_company(conn, slug, fetch_slug, ats, ts, ok):
    conn.execute(
        "INSERT INTO companies (slug, fetch_slug, name, ats, first_seen, last_seen, last_fetch_ok) "
        "VALUES (?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(slug) DO UPDATE SET fetch_slug = COALESCE(excluded.fetch_slug, companies.fetch_slug), "
        "ats = COALESCE(excluded.ats, companies.ats), last_seen = excluded.last_seen, "
        "last_fetch_ok = excluded.last_fetch_ok",
        (slug, fetch_slug, slug, ats, ts, ts, int(ok)),
    )


def upsert_seeds(conn, entries, ts=None):
    """Write name, industries, source and notes from seeds/companies.csv onto the companies table."""
    ts = ts or now()
    for e in entries:
        ats = None if e.get("ats") in (None, "none") else e["ats"]
        conn.execute(
            "INSERT INTO companies (slug, fetch_slug, name, ats, industries, source, notes, first_seen, last_seen) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(slug) DO UPDATE SET name = excluded.name, industries = excluded.industries, "
            "source = excluded.source, notes = excluded.notes, "
            "fetch_slug = COALESCE(companies.fetch_slug, excluded.fetch_slug), "
            "ats = CASE WHEN excluded.ats IS NOT NULL THEN excluded.ats ELSE companies.ats END",
            (e["slug"], e.get("fetch_slug"), e.get("name") or e["slug"], ats, json.dumps(e.get("industries") or []),
             e.get("source"), e.get("notes"), ts, ts),
        )


def record_company_run(conn, slug, fetch_slug, ats, jobs, tier_fn, ts=None):
    """Store one successfully fetched company: upsert its matched postings, close what vanished, rebuild roles.

    `jobs` is every posting on the board; only ones `tier_fn` matches are stored.
    """
    ts = ts or now()
    upsert_company(conn, slug, fetch_slug, ats, ts, ok=True)
    conn.execute("UPDATE postings SET present_last_run = 0 WHERE company_slug = ? AND COALESCE(source, 'ats') = 'ats'",
                 (slug,))
    for job in jobs:
        if not tier_fn(job.get("title")):
            continue
        norm = normalise.normalise_title(job.get("title"))
        conn.execute(
            "INSERT INTO postings (url, role_key, company_slug, title, location, other_locations, country, "
            "remote, updated, posted, team, description, first_seen, last_seen, present_last_run) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1) "
            "ON CONFLICT(url) DO UPDATE SET role_key = excluded.role_key, company_slug = excluded.company_slug, "
            "title = excluded.title, location = excluded.location, other_locations = excluded.other_locations, "
            "country = excluded.country, remote = excluded.remote, updated = excluded.updated, "
            f"posted = {EARLIEST_POSTED}, team = COALESCE(excluded.team, postings.team), "
            "description = COALESCE(excluded.description, postings.description), "
            "last_seen = excluded.last_seen, present_last_run = 1, source = 'ats'",
            (
                _posting_url(slug, job), normalise.role_key(slug, norm), slug,
                normalise.title_display(job.get("title")), job.get("location"),
                json.dumps(job.get("other_locations") or []), job.get("country"),
                _bool_int(job.get("remote")), job.get("updated"), job.get("posted"), job.get("team"), descriptions.clean(job.get("description")), ts, ts,
            ),
        )
    rebuild_roles(conn, slug, tier_fn, ts)


def record_manual_jobs(conn, jobs, tier_fn, ts=None):
    """Import seeds/manual_jobs.json: roles added by hand. A job removed from the file closes.

    A `description` is the advert's own text. It matters: without one the relevance classifier has no
    evidence and rules the role off the board, which once took a real role off the board. With the text, a manual role is judged on the same evidence
    as a scraped one. Descriptions stay in the database and never reach the exported public file.
    """
    ts = ts or now()
    touched = {r[0] for r in conn.execute("SELECT DISTINCT company_slug FROM postings WHERE source = 'manual'")}
    conn.execute("UPDATE postings SET present_last_run = 0 WHERE source = 'manual'")
    for job in jobs:
        slug = job["company_slug"]
        touched.add(slug)
        if not conn.execute("SELECT 1 FROM companies WHERE slug = ?", (slug,)).fetchone():
            upsert_company(conn, slug, None, None, ts, ok=True)
        url = job.get("url") or f"manual:{slug}:{normalise.slugify(job['title'])}:{normalise.slugify(job.get('location'))}"
        conn.execute(
            "INSERT INTO postings (url, role_key, company_slug, title, location, other_locations, country, remote, "
            "updated, posted, description, first_seen, last_seen, present_last_run, source) "
            "VALUES (?, ?, ?, ?, ?, '[]', NULL, ?, ?, ?, ?, ?, ?, 1, 'manual') "
            "ON CONFLICT(url) DO UPDATE SET role_key = excluded.role_key, title = excluded.title, "
            "location = excluded.location, remote = excluded.remote, last_seen = excluded.last_seen, "
            "description = excluded.description, present_last_run = 1, source = 'manual'",
            (url, normalise.role_key(slug, normalise.normalise_title(job["title"])), slug,
             normalise.title_display(job["title"]), job.get("location"), _bool_int(job.get("remote")),
             job.get("added"), job.get("added"), descriptions.clean(job.get("description")), ts, ts),
        )
    for slug in touched:
        rebuild_roles(conn, slug, tier_fn, ts)
        # Start from scraped state, then re-apply what the current file confirms.
        conn.execute("UPDATE roles SET listing_state = 'scraped' WHERE company_slug = ? AND listing_state = 'confirmed'",
                     (slug,))
        reset = [r[0] for r in conn.execute(
            "SELECT role_key FROM roles WHERE company_slug = ? AND industry_source = 'manual'", (slug,))]
        conn.executemany("UPDATE roles SET industry_source = NULL WHERE role_key = ?", [(k,) for k in reset])
        rebuild_roles(conn, slug, tier_fn, ts)
    conn.execute(
        "UPDATE roles SET listing_state = 'confirmed' WHERE role_key IN "
        "(SELECT role_key FROM postings WHERE source = 'manual' AND present_last_run = 1)"
    )
    for job in jobs:
        if job.get("industries"):
            key = normalise.role_key(job["company_slug"], normalise.normalise_title(job["title"]))
            conn.execute("UPDATE roles SET industries = ?, industry_source = 'manual' WHERE role_key = ?",
                         (json.dumps(job["industries"]), key))


def record_company_failed(conn, slug, fetch_slug, ats, ts=None):
    """A failed fetch changes nothing about roles; only the company's fetch flag moves."""
    ts = ts or now()
    exists = conn.execute("SELECT 1 FROM companies WHERE slug = ?", (slug,)).fetchone()
    if exists:
        conn.execute("UPDATE companies SET last_fetch_ok = 0 WHERE slug = ?", (slug,))


def rebuild_roles(conn, slug, tier_fn, ts):
    rows = conn.execute(
        "SELECT url, role_key, title, location, other_locations, country, remote, first_seen, last_seen, "
        "present_last_run, description, posted, team FROM postings WHERE company_slug = ? "
        "ORDER BY first_seen, url",
        (slug,),
    ).fetchall()
    groups = defaultdict(list)
    for r in rows:
        groups[r[1]].append(r)
    existing = {
        k: (fs, status, closed_at, src)
        for k, fs, status, closed_at, src in conn.execute(
            "SELECT role_key, first_seen, status, closed_at, industry_source FROM roles WHERE company_slug = ?", (slug,)
        )
    }
    for key, posts in groups.items():
        present = [p for p in posts if p[9]]
        use = present or posts
        title_norm = normalise.normalise_title(use[0][2])
        locations, seen = [], set()
        for p in use:
            for loc in [p[3]] + json.loads(p[4] or "[]"):
                if loc and loc not in seen:
                    seen.add(loc)
                    locations.append(loc)
        countries = Counter(
            normalise.parse_location(p[3], p[5])["country"] for p in use
        )
        countries.pop(None, None)
        country = countries.most_common(1)[0][0] if countries else None
        remotes = {p[6] for p in use}
        remote = 1 if 1 in remotes else (0 if remotes == {0} else None)
        urls = [p[0] for p in use if not p[0].startswith(("nourl:", "manual:"))]
        prev = existing.get(key)
        first_seen = prev[0] if prev and prev[0] else min(p[7] for p in posts)
        last_seen = max(p[8] for p in posts)
        posted = min((p[11] for p in posts if p[11]), default=None)
        team = next((p[12] for p in use if p[12]), None) or next((p[12] for p in posts if p[12]), None)
        if present:
            status, closed_at = "live", None
        else:
            status = "closed"
            closed_at = prev[2] if prev and prev[1] == "closed" and prev[2] else ts
        conn.execute(
            "INSERT INTO roles (role_key, company_slug, title_display, title_norm, tier, locations, country, "
            "remote, urls, status, posted, team, first_seen, last_seen, closed_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(role_key) DO UPDATE SET title_display = excluded.title_display, "
            "title_norm = excluded.title_norm, tier = excluded.tier, locations = excluded.locations, "
            "country = excluded.country, remote = excluded.remote, urls = excluded.urls, "
            "status = excluded.status, posted = excluded.posted, team = excluded.team, "
            "last_seen = excluded.last_seen, "
            "closed_at = excluded.closed_at",
            (key, slug, title_norm, title_norm, tier_fn(use[0][2]) or "adjacent", json.dumps(locations), country, remote,
             json.dumps(urls), status, posted, team, first_seen, last_seen, closed_at),
        )
        description = next((p[10] for p in use if p[10]), None) or next((p[10] for p in posts if p[10]), None)
        if not (prev and prev[3] == "manual"):
            set_tags(conn, key, *industries.tag_role(title_norm, description))
        set_relevance(conn, key, title_norm, description, tier_fn(use[0][2]) or "adjacent")
    # Roles whose postings all moved to a different key (normaliser change) have nothing left behind them.
    stale = [k for k in existing if k not in groups]
    conn.executemany("DELETE FROM roles WHERE role_key = ? AND listing_state = 'scraped'", [(k,) for k in stale])


def set_tags(conn, role_key, tags, source):
    conn.execute("UPDATE roles SET industries = ?, industry_source = ? WHERE role_key = ?",
                 (json.dumps(tags), source, role_key))


def set_relevance(conn, role_key, title, description, tier):
    verdict, reason = relevance_mod.classify(title, description, tier)
    conn.execute("UPDATE roles SET relevance = ?, relevance_reason = ?, flags = ? WHERE role_key = ?",
                 (verdict, reason, json.dumps(relevance_mod.flags(title, description)), role_key))


def retag_all(conn):
    """Re-tag every role from its stored title and descriptions, without fetching. Manual tags are kept."""
    rows = conn.execute(
        "SELECT r.role_key, r.title_norm, r.tier, COALESCE(r.industry_source, '') = 'manual' AS manual, "
        "(SELECT p.description FROM postings p WHERE p.role_key = r.role_key AND p.description IS NOT NULL "
        " ORDER BY p.present_last_run DESC, p.first_seen, p.url LIMIT 1) "
        "FROM roles r"
    ).fetchall()
    for key, title, tier, manual, description in rows:
        if not manual:
            set_tags(conn, key, *industries.tag_role(title, description))
        set_relevance(conn, key, title, description, tier or "adjacent")
    # Greenhouse gives the team only on the per-job call, which runs after roles are built.
    conn.execute("UPDATE roles SET team = (SELECT p.team FROM postings p WHERE p.role_key = roles.role_key "
                 "AND p.team IS NOT NULL ORDER BY p.present_last_run DESC, p.first_seen, p.url LIMIT 1) "
                 "WHERE team IS NULL")
    conn.commit()
    return sum(1 for r in rows if not r[3])


def tag_report(conn, untagged_top=20):
    rows = conn.execute("SELECT title_norm, industries, industry_source FROM roles").fetchall()
    total = len(rows)
    by_source = Counter(src for _, _, src in rows)
    per_industry = Counter()
    untagged = Counter()
    for title, tags, src in rows:
        tags = json.loads(tags) if tags else []
        per_industry.update(tags)
        if not tags:
            untagged[title] += 1
    return {
        "roles": total, "title": by_source.get("title", 0), "description": by_source.get("description", 0),
        "manual": by_source.get("manual", 0), "untagged": sum(untagged.values()),
        "per_industry": per_industry, "untagged_top": untagged.most_common(untagged_top),
    }


def close_unseeded(conn, active_slugs, tier_fn, ts=None):
    """Full runs only: close scraped roles of companies no longer probed (removed from the CSV or set to none)."""
    ts = ts or now()
    closed = []
    rows = conn.execute("SELECT DISTINCT company_slug FROM postings WHERE COALESCE(source, 'ats') = 'ats' "
                        "AND present_last_run = 1").fetchall()
    for (slug,) in rows:
        if slug not in active_slugs:
            conn.execute("UPDATE postings SET present_last_run = 0 WHERE company_slug = ? "
                         "AND COALESCE(source, 'ats') = 'ats'", (slug,))
            rebuild_roles(conn, slug, tier_fn, ts)
            closed.append(slug)
    return closed


def live_roles(conn):
    cur = conn.execute(
        "SELECT role_key, company_slug, tier, title_display, locations, country, remote, urls, industries, "
        "first_seen, last_seen, relevance FROM roles WHERE status = 'live' ORDER BY company_slug, title_norm"
    )
    out = []
    for key, slug, tier, title, locs, country, remote, urls, inds, fs, ls, rel in cur:
        out.append({
            "role_key": key, "company": slug, "tier": tier, "title": title,
            "locations": json.loads(locs or "[]"), "country": country,
            "remote": None if remote is None else bool(remote), "urls": json.loads(urls or "[]"),
            "industries": json.loads(inds) if inds else [], "first_seen": fs, "last_seen": ls,
            "relevance": rel,
        })
    return out


def add_to_waitlist(conn, entry, ts=None):
    """Insert a candidate. An email already on the list is left untouched. Returns True when a row was added."""
    ts = ts or now()
    cur = conn.execute(
        "INSERT OR IGNORE INTO waitlist (email, name, linkedin_url, tiers, industries, years, location, remote_pref, "
        "note, consented_at, created_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (entry["email"].strip().lower(), entry.get("name"), entry.get("linkedin_url"), json.dumps(entry["tiers"]),
         json.dumps(entry["industries"]), entry.get("years"), entry.get("location"), entry.get("remote_pref"),
         entry.get("note"), ts, ts, entry.get("source") or "join_form"),
    )
    conn.commit()
    return cur.rowcount == 1


def counts(conn):
    one = lambda sql: conn.execute(sql).fetchone()[0]  # noqa: E731
    return {
        "postings": one("SELECT count(*) FROM postings"),
        "roles": one("SELECT count(*) FROM roles"),
        "live_roles": one("SELECT count(*) FROM roles WHERE status = 'live'"),
        "closed_roles": one("SELECT count(*) FROM roles WHERE status = 'closed'"),
        "by_tier": dict(conn.execute("SELECT tier, count(*) FROM roles WHERE status = 'live' GROUP BY tier")),
        "with_description": one("SELECT count(*) FROM postings WHERE description IS NOT NULL"),
        "by_relevance": dict(conn.execute(
            "SELECT COALESCE(relevance, 'unknown'), count(*) FROM roles WHERE status = 'live' GROUP BY 1")),
    }
