"""Signal 1 (M11): hiring intent computed from our own archive. Stdlib only.

Two halves:
- `advance` keeps the closure archive. CI rebuilds its database from scratch every run, so which roles
  were open, which closed and when, and when we started watching each company live in a small JSON
  document (`engine/history.json` in the site repo) that this function updates in place.
- `compute` turns live roles, closed roles and watch dates into the numbers the site shows. The local
  export and CI both call it, so the two can never disagree about what a signal means.

Only core roles count towards company signals: "related" roles are adjacent work and would make a sales
engineering team look like a deployment team.
"""
import json
from datetime import date, datetime
from statistics import median

OPENED_WINDOW = 30  # days: "opened in the last 30 days"
WATCH_BEFORE_NET = 30  # days we must have watched a company before its closures mean anything
NEW_WINDOW = 60  # days: every open core role posted inside this window reads as new to deployment hiring
LONG_OPEN = 90  # days: a role open this long is one they are struggling to fill
ALWAYS_OPEN = 365  # days: past a year it is a standing pipeline listing, not a hard-to-fill role
MIN_FOR_MEDIAN = 3  # closed roles before a median time to close is shown

# A single run that would close more than this share of the open board (and at least MIN_SUSPECT roles) is
# far more likely a title-pattern change or a half-broken scrape than a real market event.
SUSPECT_SHARE = 0.25
MIN_SUSPECT = 20


def empty_history():
    return {"watching": {}, "open": {}, "closed": {}}


def open_entry(role):
    """What the archive keeps about a live role: enough to count it after it has gone."""
    return {"company": role["company"], "title": role.get("title"), "urls": sorted(role.get("urls") or []),
            "posted": role.get("posted"), "relevance": role.get("relevance"), "first_seen": role.get("first_seen")}


def advance(history, live_roles, attempted, fetched_ok, ts, min_suspect=MIN_SUSPECT):
    """Update the archive after one scrape. Mutates `history`; returns what changed.

    `live_roles`: every live role this run, any relevance. `attempted`: companies whose board we tried.
    `fetched_ok`: the ones that answered cleanly. A role missing from this run is closed only when its
    company fetched cleanly and none of its listing URLs is still up (otherwise it was renamed).
    """
    for slug in sorted(fetched_ok):
        history["watching"].setdefault(slug, ts)

    now_open = {r["role_key"]: open_entry(r) for r in live_roles}
    live_urls = {u for r in live_roles for u in (r.get("urls") or [])}
    closing, carried, dropped, renamed = {}, {}, 0, 0
    for key, prev in history["open"].items():
        if key in now_open:
            continue
        slug = prev["company"]
        if slug not in attempted:
            dropped += 1  # removed from the seeds or no board any more: we stopped looking, nothing closed
        elif slug not in fetched_ok:
            carried[key] = prev  # the fetch failed: we do not know, so it stays open
        elif set(prev.get("urls") or []) & live_urls:
            renamed += 1  # the listing is still up under a new role key
        else:
            closing[key] = prev

    suspect = 0
    if len(closing) >= min_suspect and len(closing) > SUSPECT_SHARE * max(len(history["open"]), 1):
        suspect, closing = len(closing), {}

    reopened = 0
    for key in now_open:
        if history["closed"].pop(key, None) is not None:
            reopened += 1
    for key, prev in closing.items():
        history["closed"][key] = dict(prev, closed_at=ts)
    history["open"] = {**carried, **now_open}
    return {"closed": len(closing), "reopened": reopened, "carried": len(carried), "dropped": dropped,
            "renamed": renamed, "suspect": suspect}


def _day(stamp):
    """'2026-09-17 09:00:00' or '2026-09-17' -> date. None stays None."""
    if not stamp:
        return None
    return datetime.strptime(stamp[:10], "%Y-%m-%d").date()


def _start(role):
    """When the role opened: the ATS publish day, or the day we first saw it when the ATS gave none."""
    return _day(role.get("posted")) or _day(role.get("first_seen"))


def compute(live_roles, closed_roles, watching, today=None):
    """Per-role time open and per-company hiring signals. Pure: same inputs, same numbers.

    Returns {"roles": {role_key: {...}}, "companies": {slug: {...}}}. Companies appear only when they have
    at least one core role, open or closed.
    """
    today = _day(today) if today else date.today()
    roles_out = {}
    for r in live_roles:
        start = _start(r)
        days = (today - start).days if start else None
        roles_out[r["role_key"]] = {"postedAt": r.get("posted"), "daysOpen": days,
                                    "longOpen": days is not None and LONG_OPEN <= days < ALWAYS_OPEN,
                                    "alwaysOpen": days is not None and days >= ALWAYS_OPEN}

    by_company = {}
    for r in live_roles:
        if r.get("relevance") == "core":
            by_company.setdefault(r["company"], {"live": [], "closed": []})["live"].append(r)
    for r in closed_roles:
        if r.get("relevance") == "core":
            by_company.setdefault(r["company"], {"live": [], "closed": []})["closed"].append(r)

    companies = {}
    for slug, group in by_company.items():
        live_days = [roles_out[r["role_key"]]["daysOpen"] for r in group["live"]
                     if roles_out[r["role_key"]]["daysOpen"] is not None]
        starts = [_start(r) for r in group["live"] + group["closed"]]
        opened = sum(1 for s in starts if s and (today - s).days <= OPENED_WINDOW)

        watched_since = _day(watching.get(slug))
        watched_days = (today - watched_since).days if watched_since else None
        closed_30 = net = None
        if watched_days is not None and watched_days >= WATCH_BEFORE_NET:
            closed_30 = sum(1 for r in group["closed"] if (today - _day(r["closed_at"])).days <= OPENED_WINDOW)
            net = opened - closed_30

        older_closed = any(_start(r) and (today - _start(r)).days > NEW_WINDOW for r in group["closed"])
        new_to_deployment = bool(group["live"]) and len(live_days) == len(group["live"]) \
            and max(live_days) <= NEW_WINDOW and not older_closed

        to_close = [(_day(r["closed_at"]) - _start(r)).days for r in group["closed"] if _start(r)]
        companies[slug] = {
            "liveCore": len(group["live"]),
            "openedLast30": opened,
            "closedLast30": closed_30,
            "net30": net,
            "watchedDays": watched_days,
            "oldestOpenDays": max(live_days) if live_days else None,
            "longOpen": sum(1 for d in live_days if LONG_OPEN <= d < ALWAYS_OPEN),
            "alwaysOpen": sum(1 for d in live_days if d >= ALWAYS_OPEN),
            "newToDeployment": new_to_deployment,
            "closedCount": len(group["closed"]),
            "medianDaysToClose": round(median(to_close)) if len(to_close) >= MIN_FOR_MEDIAN else None,
        }
    return {"roles": roles_out, "companies": companies}


# ---- reading the database ---------------------------------------------------------------------

def _rows(conn, status):
    return conn.execute(
        "SELECT role_key, company_slug, title_display, urls, posted, relevance, first_seen, closed_at "
        "FROM roles WHERE status = ? ORDER BY role_key", (status,)).fetchall()


def _role_dict(row):
    key, slug, title, urls, posted, relevance, first_seen, closed_at = row
    return {"role_key": key, "company": slug, "title": title, "urls": json.loads(urls or "[]"), "posted": posted,
            "relevance": relevance or "core", "first_seen": first_seen, "closed_at": closed_at}


def db_live(conn):
    return [_role_dict(r) for r in _rows(conn, "live")]


def db_closed(conn):
    """Closed roles as the local database recorded them. CI's database has none: it reads history.json."""
    return [_role_dict(r) for r in _rows(conn, "closed")]


def db_fetch_state(conn):
    """(companies whose board we tried this run, the ones that answered cleanly)."""
    rows = conn.execute("SELECT slug, last_fetch_ok FROM companies WHERE last_fetch_ok IS NOT NULL").fetchall()
    return {s for s, _ in rows}, {s for s, ok in rows if ok}


def db_watching(conn):
    """The local database's stand-in for watch dates: when each company first went in."""
    return dict(conn.execute("SELECT slug, first_seen FROM companies WHERE first_seen IS NOT NULL"))


# ---- decorating the export --------------------------------------------------------------------

def attach(doc, result):
    """Add time open to each exported role and a signals block to each company, in place."""
    for role in doc["roles"]:
        role.update(result["roles"].get(role["id"])
                    or {"postedAt": None, "daysOpen": None, "longOpen": False, "alwaysOpen": False})
    for company in doc["companies"]:
        company["signals"] = result["companies"].get(company["slug"])
    exported = {r["id"] for r in doc["roles"]}
    doc["counts"]["newToDeployment"] = sum(1 for c in result["companies"].values() if c["newToDeployment"])
    doc["counts"]["longOpen"] = sum(1 for k, r in result["roles"].items() if k in exported and r["longOpen"])
    return doc
