"""Public ATS job-board fetchers, detection and polite HTTP. Stdlib only (Python 3.9).

Every fetcher has the signature ``fetcher(slug, get=...)`` and returns either
  * a list of normalised postings
    ``{title, location, country, remote, url, updated, description, other_locations}``
    (an empty list means the board exists but has no open roles), or
  * ``None`` when there is no board for that slug on that ATS.
A fetch that keeps failing (429, 5xx, network) raises ``FetchFailed``.

``get`` is injectable so tests never touch the network. It takes a URL and returns
``(status, parsed_json_or_None)``. The default is ``fetch_json``: rate limited per host,
with retries and 2s/4s/8s backoff.

Robots and terms were checked on 16 Sep 2026, see LEARNINGS.md.
"""
import json
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from urllib.parse import urlsplit

USER_AGENT = "fde-board-scraper/0.2 (local, non-commercial preview)"
TIMEOUT = 20
BACKOFF = (2, 4, 8)  # seconds between attempts; 1 try + 3 retries
MAX_RETRY_AFTER = 60


class FetchFailed(Exception):
    def __init__(self, host, status):
        super().__init__(f"{host} {status}")
        self.host = host
        self.status = status  # HTTP status, or 0 for a network error / timeout


class HostLimit:
    """At most ``concurrency`` requests in flight and ``interval`` seconds between request starts."""

    def __init__(self, concurrency, interval=0.0):
        self.sem = threading.BoundedSemaphore(concurrency)
        self.interval = interval
        self.lock = threading.Lock()
        self.next_at = 0.0
        self.closed = False  # set when the host asks us to stay away longer than MAX_RETRY_AFTER

    def __enter__(self):
        self.sem.acquire()
        if self.interval:
            with self.lock:
                now = time.monotonic()
                wait = self.next_at - now
                self.next_at = max(now, self.next_at) + self.interval
            if wait > 0:
                time.sleep(wait)
        return self

    def __exit__(self, *exc):
        self.sem.release()

    def pause(self, seconds):
        """Hold back every worker on this host, not just the one that was told to slow down."""
        with self.lock:
            self.next_at = max(self.next_at, time.monotonic() + seconds)


# Lever: robots.txt Crawl-delay: 1 on both hosts. Workable returned 429 after ~80 requests in a
# minute on 16 Sep, and still 429'd twice in a full run at one request start per second, so it gets
# 1 at a time and one start every 4 seconds (15 a minute); Cloudflare challenged this IP after a day of test runs. Greenhouse and Ashby: 8 concurrent.
LIMITS = {
    "api.lever.co": HostLimit(1, 1.0),
    "api.eu.lever.co": HostLimit(1, 1.0),
    "apply.workable.com": HostLimit(1, 4.0),
    "boards-api.greenhouse.io": HostLimit(8),
    "api.ashbyhq.com": HostLimit(8),
}
DEFAULT_LIMIT = HostLimit(4)


def host_of(url):
    return urlsplit(url).hostname or ""


def raw_get_json(url):
    """One rate-limited GET. Returns (status, parsed JSON or None, Retry-After seconds or None).

    Network errors are status 0.
    """
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    retry_after = None
    with LIMITS.get(host_of(url), DEFAULT_LIMIT):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                status, body = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, body = e.code, b""
            retry_after = _retry_after(e.headers.get("Retry-After") if e.headers else None)
            if status == 429:
                _log_first_429(url, e.headers)
        except (urllib.error.URLError, TimeoutError, OSError):
            return 0, None, None
    try:
        return status, (json.loads(body) if body else None), retry_after
    except ValueError:
        return status, None, retry_after


_LOGGED_429 = set()


def _log_first_429(url, headers):
    host = host_of(url)
    if host in _LOGGED_429:
        return
    _LOGGED_429.add(host)
    keep = {k: v for k, v in (headers or {}).items()
            if k.lower().startswith(("retry", "x-ratelimit", "ratelimit", "cf-", "server"))}
    print(f"first 429 from {host}: {keep}", file=sys.stderr)


def _retry_after(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def retryable(status):
    return status == 0 or status == 429 or status >= 500


def fetch_json(url, get_json=raw_get_json, sleep=time.sleep, backoff=BACKOFF, limits=None):
    """GET with retries on 429, 5xx and network errors. Raises FetchFailed when retries run out.

    A 429 also pauses the whole host in ``limits`` for the backoff, so other workers back off too.
    """
    limits = LIMITS if limits is None else limits
    host = host_of(url)
    limit = limits.get(host)
    status = 0
    for attempt in range(len(backoff) + 1):
        if limit is not None and limit.closed:
            # The host told us to come back much later: send nothing more to it this run.
            raise FetchFailed(host, 429)
        resp = get_json(url)
        status, data = resp[0], resp[1]
        if not retryable(status):
            return status, data
        hint = resp[2] if len(resp) > 2 else None
        if status == 429 and hint and hint > MAX_RETRY_AFTER:
            if limit is not None and not limit.closed:
                limit.closed = True
                print(f"{host} sent Retry-After {int(hint)}s; no more requests to it this run", file=sys.stderr)
            raise FetchFailed(host, 429)
        if attempt < len(backoff):
            # Honour the server's Retry-After when it asks for longer than our backoff.
            delay = max(backoff[attempt], hint or 0)
            if status == 429 and limit is not None:
                limit.pause(delay)
            sleep(delay)
    raise FetchFailed(host_of(url), status)


def _iso_from_ms(ms):
    if not isinstance(ms, (int, float)):
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def posted_day(raw, today=None):
    """The day a listing was first published, as a UTC 'YYYY-MM-DD', or None when the ATS gave nothing usable.

    Takes ISO strings with or without an offset, bare dates and epoch milliseconds. Epoch-zero and future
    dates are unset fields, not real ones, so they are dropped rather than read as a very old or new role.
    """
    if isinstance(raw, bool) or raw in (None, ""):
        return None
    try:
        if isinstance(raw, (int, float)):
            dt = datetime.fromtimestamp(raw / 1000, tz=timezone.utc)
        else:
            dt = datetime.fromisoformat(str(raw).strip().replace("Z", "+00:00"))
            if dt.tzinfo is not None:
                dt = dt.astimezone(timezone.utc)
    except (ValueError, OverflowError, OSError):
        # Python 3.9 (local) rejects fractions that are not 3 or 6 digits; 3.12 (CI) takes them. Keep the day.
        m = re.match(r"(\d{4}-\d{2}-\d{2})T", str(raw))
        if not m:
            return None
        dt = datetime.strptime(m.group(1), "%Y-%m-%d")
    day = dt.strftime("%Y-%m-%d")
    today = today or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if day < "2010-01-01" or day > today:
        return None
    return day


def posting(title, location=None, country=None, remote=None, url=None, updated=None,
            description=None, other_locations=None, posted=None, team=None):
    return {
        "title": (title or "").strip(),
        "location": location or None,
        "country": country or None,
        "remote": remote,
        "url": url,
        "updated": updated,
        "description": description or None,
        "other_locations": other_locations or [],
        "posted": posted_day(posted),
        # The team or department the listing sits under: a job attribute, never a person.
        "team": (team or "").strip() or None,
    }


def greenhouse(slug, get=fetch_json):
    status, d = get(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs")
    if status != 200 or not isinstance(d, dict) or not isinstance(d.get("jobs"), list):
        return None
    # The list call carries no content; per-job descriptions are fetched incrementally in M2.
    return [
        posting(j.get("title"), location=(j.get("location") or {}).get("name"),
                url=j.get("absolute_url"), updated=j.get("updated_at"),
                posted=j.get("first_published"))
        for j in d["jobs"]
    ]


def _lever(host, slug, get):
    status, d = get(f"https://{host}/v0/postings/{slug}?mode=json")
    if status != 200 or not isinstance(d, list):
        return None
    out = []
    for j in d:
        cats = j.get("categories") or {}
        wt = (j.get("workplaceType") or "").lower()
        remote = True if wt == "remote" else False if wt in ("onsite", "on-site", "hybrid") else None
        others = [l for l in (cats.get("allLocations") or []) if l and l != cats.get("location")]
        out.append(posting(j.get("text"), location=cats.get("location"), country=j.get("country"),
                           remote=remote, url=j.get("hostedUrl"), updated=_iso_from_ms(j.get("createdAt")),
                           description=j.get("descriptionPlain"), other_locations=others,
                           posted=j.get("createdAt"), team=cats.get("team") or cats.get("department")))
    return out


def lever(slug, get=fetch_json):
    return _lever("api.lever.co", slug, get)


def lever_eu(slug, get=fetch_json):
    return _lever("api.eu.lever.co", slug, get)


def ashby(slug, get=fetch_json):
    status, d = get(f"https://api.ashbyhq.com/posting-api/job-board/{slug}")
    if status != 200 or not isinstance(d, dict) or not isinstance(d.get("jobs"), list):
        return None
    out = []
    for j in d["jobs"]:
        if not j.get("isListed", True):
            continue
        addr = ((j.get("address") or {}).get("postalAddress") or {})
        remote = j.get("isRemote")
        if remote is None and j.get("workplaceType"):
            remote = j["workplaceType"].lower() == "remote"
        others = [s.get("location") for s in (j.get("secondaryLocations") or []) if s.get("location")]
        out.append(posting(j.get("title"), location=j.get("location"), country=addr.get("addressCountry"),
                           remote=remote, url=j.get("jobUrl"), updated=j.get("publishedAt"),
                           description=j.get("descriptionPlain"), other_locations=others,
                           posted=j.get("publishedAt"), team=j.get("team") or j.get("department")))
    return out


def workable(slug, get=fetch_json):
    status, d = get(f"https://apply.workable.com/api/v1/widget/accounts/{slug}")
    if status != 200 or not isinstance(d, dict) or not isinstance(d.get("jobs"), list):
        return None
    if not d["jobs"]:
        # Workable answers 200 with an empty account for slugs that are not a live board,
        # so an empty account proves nothing.
        return None
    # Descriptions need a per-job fetch; left as None.
    return [
        posting(j.get("title"), location=", ".join(filter(None, [j.get("city"), j.get("country")])),
                country=j.get("country"), remote=j.get("telecommuting"),
                url=j.get("url") or j.get("shortlink"), updated=j.get("published_on"),
                posted=j.get("published_on"))
        for j in d["jobs"]
    ]


ATS = {
    "greenhouse": greenhouse,
    "lever": lever,
    "lever-eu": lever_eu,
    "ashby": ashby,
    "workable": workable,
}
ATS_ORDER = list(ATS)


# ---- seed overrides ---------------------------------------------------------------------------

def parse_seed_line(line):
    """``a`` | ``a@ats`` | ``a=b@ats`` | ``a@none`` -> {slug, fetch_slug, ats} or None for blanks/comments.

    ``ats`` is None (try every ATS), an ATS name (only that one), or "none" (never probe).
    """
    line = line.split("#", 1)[0].strip().lower()
    if not line:
        return None
    ats = None
    if "@" in line:
        line, ats = (p.strip() for p in line.rsplit("@", 1))
        if ats != "none" and ats not in ATS:
            raise ValueError(f"unknown ATS in seed override: {ats!r}")
    slug, fetch_slug = line, line
    if "=" in line:
        slug, fetch_slug = (p.strip() for p in line.split("=", 1))
    if not slug or not fetch_slug:
        raise ValueError(f"bad seed line: {line!r}")
    return {"slug": slug, "fetch_slug": fetch_slug, "ats": ats}


def parse_seeds(text):
    out = {}
    for raw in text.splitlines():
        e = parse_seed_line(raw)
        if e and e["slug"] not in out:
            out[e["slug"]] = e
    return list(out.values())


SEED_COLUMNS = ["slug", "fetch_slug", "name", "ats_override", "industries", "source", "notes", "domain"]


def load_seeds_csv(text):
    """seeds/companies.csv -> entries {slug, fetch_slug, ats, name, industries, source, notes}.

    ``fetch_slug`` defaults to ``slug``; ``ats_override`` is blank (try every ATS), an ATS name, or ``none``.
    """
    import csv
    import io

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames != SEED_COLUMNS:
        raise ValueError(f"companies.csv header must be {','.join(SEED_COLUMNS)}, got {reader.fieldnames}")
    out = {}
    for row in reader:
        slug = (row["slug"] or "").strip().lower()
        if not slug or slug in out:
            continue
        override = (row["ats_override"] or "").strip().lower() or None
        if override is not None and override != "none" and override not in ATS:
            raise ValueError(f"unknown ats_override for {slug}: {override!r}")
        out[slug] = {
            "slug": slug,
            "fetch_slug": (row["fetch_slug"] or "").strip() or slug,
            "ats": override,
            "name": (row["name"] or "").strip() or slug,
            "industries": [i.strip() for i in (row["industries"] or "").split("|") if i.strip()],
            "source": (row["source"] or "").strip() or None,
            "notes": (row["notes"] or "").strip() or None,
            "domain": (row.get("domain") or "").strip() or None,
        }
    return list(out.values())


# ---- detection --------------------------------------------------------------------------------

def utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _try(ats, fetch_slug, get, run):
    """Run one fetcher, return (ats, postings or None, failure or None)."""
    try:
        return ats, run(ATS[ats], fetch_slug, get), None
    except FetchFailed as e:
        return ats, None, e


def _sequential(tasks, get):
    return [_try(ats, fs, get, lambda fn, s, g: fn(s, get=g)) for ats, fs in tasks]


def scrape_slug(entry, cached=None, get=fetch_json, runner=None):
    """Detect and fetch one seed.

    Returns {slug, board, jobs, failed, skipped}:
      board   {"ats", "fetch_slug", "open_roles", "also_seen_on", "checked"} or None
      jobs    postings from the chosen board
      failed  [{"slug", "host", "status"}] for fetches that ran out of retries
      skipped True for ``@none`` seeds (never probed)
    ``runner(tasks, get)`` runs [(ats, fetch_slug)] and returns [(ats, postings|None, FetchFailed|None)].
    """
    runner = runner or _sequential
    slug = entry["slug"]
    res = {"slug": slug, "board": None, "jobs": [], "failed": [], "skipped": False}
    if entry.get("ats") == "none":
        res["skipped"] = True
        return res

    fetch_slug = entry.get("fetch_slug") or slug
    found = {}  # ats -> postings (list, possibly empty)

    def record(results):
        for ats, jobs, err in results:
            if err is not None:
                res["failed"].append({"slug": slug, "host": err.host, "status": err.status})
            elif jobs is not None:
                found[ats] = jobs

    if entry.get("ats"):
        record(runner([(entry["ats"], fetch_slug)], get))
    else:
        cached_ats = (cached or {}).get("ats")
        tried = []
        if cached_ats in ATS and (cached or {}).get("fetch_slug", fetch_slug) == fetch_slug:
            record(runner([(cached_ats, fetch_slug)], get))
            tried.append(cached_ats)
            if found.get(cached_ats) or res["failed"]:
                # Cached board still has roles (or the host failed): no sweep this run.
                if not found.get(cached_ats):
                    return res
                prev = [a for a in (cached or {}).get("also_seen_on", []) if a.get("ats") != cached_ats]
                return _finish(res, entry, fetch_slug, cached_ats, found[cached_ats], prev)
        record(runner([(a, fetch_slug) for a in ATS_ORDER if a not in tried], get))

    if not found:
        return res
    best = max(ATS_ORDER, key=lambda a: (len(found[a]), -ATS_ORDER.index(a)) if a in found else (-1, 0))
    also = [{"ats": a, "open_roles": len(found[a])} for a in ATS_ORDER if a in found and a != best]
    return _finish(res, entry, fetch_slug, best, found[best], also)


def _finish(res, entry, fetch_slug, ats, jobs, also):
    res["board"] = {"ats": ats, "fetch_slug": fetch_slug, "open_roles": len(jobs),
                    "also_seen_on": also, "checked": utc_now()}
    res["jobs"] = jobs
    return res
