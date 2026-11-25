"""Read-only queries for the web app and scripts. Stdlib only, so scripts can import it without Flask.

Every role query filters `status = 'live'`. One connection per call, WAL mode.
"""
import json
import sqlite3

DEFAULT_TIERS = ("fde", "deployment")
TIERS = ("fde", "deployment", "adjacent")
OTHER_COUNTRY = "Other"


def connect(db_path):
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _where(tiers=None, industry=None, country=None, remote=None, since_days=None, company=None, related=False,
           relevance=None, q=None):
    clauses = ["r.status = 'live'"]
    params = []
    # Relevance decides what a candidate sees by default: deployment work with customers, nothing else.
    wanted = list(relevance) if relevance else (["core", "related"] if related else ["core"])
    clauses.append("COALESCE(r.relevance, 'core') IN (%s)" % ",".join("?" * len(wanted)))
    params.extend(wanted)
    tiers = [t for t in (tiers or TIERS) if t in TIERS] or list(TIERS)
    clauses.append("r.tier IN (%s)" % ",".join("?" * len(tiers)))
    params.extend(tiers)
    if industry:
        # A role matches on its own tags, or on its company's industries unless that is "horizontal".
        clauses.append(
            "(EXISTS (SELECT 1 FROM json_each(COALESCE(r.industries, '[]')) WHERE value = ?) "
            "OR (? != 'horizontal' AND EXISTS (SELECT 1 FROM json_each(COALESCE(c.industries, '[]')) WHERE value = ?)))"
        )
        params.extend([industry, industry, industry])
    if country == OTHER_COUNTRY:
        clauses.append("r.country IS NULL")
    elif country:
        clauses.append("r.country = ?")
        params.append(country)
    if remote:
        clauses.append("r.remote = 1")
    if since_days is not None:
        clauses.append("r.first_seen >= datetime('now', ?)")
        params.append(f"-{int(since_days)} days")
    if company:
        clauses.append("r.company_slug = ?")
        params.append(company)
    if q:
        clauses.append("(r.title_display LIKE ? OR COALESCE(c.name, r.company_slug) LIKE ?)")
        params.extend([f"%{q}%", f"%{q}%"])
    return " AND ".join(clauses), params


FROM = "FROM roles r LEFT JOIN companies c ON c.slug = r.company_slug"


def _role(row):
    role_tags = json.loads(row["industries"] or "[]")
    company_tags = [i for i in json.loads(row["company_industries"] or "[]") if i != "horizontal"]
    return {
        "role_key": row["role_key"],
        "company_slug": row["company_slug"],
        "company_name": row["company_name"] or row["company_slug"],
        "title": row["title_display"],
        "tier": row["tier"],
        "locations": json.loads(row["locations"] or "[]"),
        "country": row["country"],
        "remote": None if row["remote"] is None else bool(row["remote"]),
        "urls": json.loads(row["urls"] or "[]"),
        "industries": role_tags,
        "industry_source": row["industry_source"],
        "company_industries": company_tags,
        "company_only_industries": [i for i in company_tags if i not in role_tags],
        "first_seen": row["first_seen"],
        "is_new": bool(row["is_new"]),
        "listing_state": row["listing_state"],
        "relevance": row["relevance"] or "core",
        "relevance_reason": row["relevance_reason"],
        "flags": json.loads(row["flags"] or "[]"),
        "team": row["team"],
    }


def list_roles(db_path, tiers=None, industry=None, country=None, remote=None, since_days=None, limit=50, offset=0,
               company=None, related=False, relevance=None, q=None):
    where, params = _where(tiers, industry, country, remote, since_days, company, related, relevance, q)
    sql = (
        "SELECT r.role_key, r.company_slug, c.name AS company_name, r.title_display, r.tier, r.locations, r.country, "
        "r.remote, r.urls, r.industries, r.industry_source, c.industries AS company_industries, r.first_seen, "
        "r.listing_state, r.relevance, r.relevance_reason, r.flags, r.team, "
        "r.first_seen >= datetime('now', '-7 days') AS is_new, "
        "MAX(r.first_seen) OVER (PARTITION BY r.company_slug) AS company_newest, "
        # Each company's newest role comes before anyone's second, so the first page shows the breadth
        # of the board instead of five roles at whichever company was scraped last.
        "ROW_NUMBER() OVER (PARTITION BY r.company_slug ORDER BY r.first_seen DESC, r.title_display) AS rank_in_company "
        f"{FROM} WHERE {where} "
        "ORDER BY rank_in_company, company_newest DESC, r.company_slug, r.title_display LIMIT ? OFFSET ?"
    )
    conn = connect(db_path)
    try:
        return [_role(row) for row in conn.execute(sql, params + [int(limit), int(offset)])]
    finally:
        conn.close()


def count_roles(db_path, tiers=None, industry=None, country=None, remote=None, since_days=None, company=None,
                related=False, relevance=None, q=None):
    where, params = _where(tiers, industry, country, remote, since_days, company, related, relevance, q)
    conn = connect(db_path)
    try:
        row = conn.execute(f"SELECT count(*), count(DISTINCT r.company_slug) {FROM} WHERE {where}", params).fetchone()
        return row[0], row[1]
    finally:
        conn.close()


def count_new_roles(db_path, days=7, tiers=None):
    return count_roles(db_path, tiers=tiers, since_days=days)[0]


def countries(db_path):
    conn = connect(db_path)
    try:
        rows = conn.execute(
            "SELECT country, count(*) FROM roles WHERE status = 'live' AND country IS NOT NULL "
            "AND COALESCE(relevance, 'core') != 'off' GROUP BY country ORDER BY count(*) DESC, country"
        ).fetchall()
        has_other = conn.execute("SELECT 1 FROM roles WHERE status = 'live' AND country IS NULL "
                                 "AND COALESCE(relevance, 'core') != 'off' LIMIT 1").fetchone()
    finally:
        conn.close()
    return [r[0] for r in rows] + ([OTHER_COUNTRY] if has_other else [])


def list_companies(db_path):
    conn = connect(db_path)
    try:
        rows = conn.execute(
            "SELECT c.slug, c.name, c.ats, c.industries, c.source, "
            "(SELECT count(*) FROM roles r WHERE r.company_slug = c.slug AND r.status = 'live' "
            " AND COALESCE(r.relevance, 'core') = 'core') AS live_roles "
            "FROM companies c ORDER BY live_roles DESC, lower(COALESCE(c.name, c.slug))"
        ).fetchall()
    finally:
        conn.close()
    return [{"slug": r["slug"], "name": r["name"] or r["slug"], "ats": r["ats"],
             "industries": json.loads(r["industries"] or "[]"), "source": r["source"], "live_roles": r["live_roles"]}
            for r in rows]


def company(db_path, slug):
    conn = connect(db_path)
    try:
        r = conn.execute("SELECT slug, name, ats, industries, source, notes FROM companies WHERE slug = ?",
                         (slug,)).fetchone()
    finally:
        conn.close()
    if r is None:
        return None
    return {"slug": r["slug"], "name": r["name"] or r["slug"], "ats": r["ats"],
            "industries": json.loads(r["industries"] or "[]"), "source": r["source"], "notes": r["notes"]}
