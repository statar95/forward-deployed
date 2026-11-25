"""Job descriptions: stored for industry tagging only, never rendered, with personal data stripped.

Greenhouse list calls carry no content, so descriptions are fetched per job, only for postings
that do not have one yet. The weekly cost is the number of new Greenhouse postings.
"""
import html
import re
from concurrent.futures import ThreadPoolExecutor

_TAGS = re.compile(r"<[^>]+>")
_BLOCK_TAGS = re.compile(r"</?(?:p|div|br|li|ul|ol|h[1-6]|tr|table|section)\b[^>]*>", re.I)
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_HANDLE = re.compile(r"@\w+")
# A run of digits and phone punctuation with 9 to 15 digits, not part of a word or a money amount.
_PHONE = re.compile(r"(?<![\w$£€.,])\+?\(?\d[\d\s().-]{7,}\d(?![\w%])")
_SPACES = re.compile(r"[ \t ]+")
_BLANKS = re.compile(r"\n\s*\n+")
GH_ID = re.compile(r"(?:/jobs/|gh_jid=)(\d+)")


def _strip_phone(m):
    digits = re.sub(r"\D", "", m.group(0))
    return "[removed]" if 9 <= len(digits) <= 15 else m.group(0)


def clean(text):
    if not text:
        return None
    t = text
    # Greenhouse `content` arrives double-escaped (&lt;p&gt;); unescape until stable.
    for _ in range(3):
        u = html.unescape(t)
        if u == t:
            break
        t = u
    t = _BLOCK_TAGS.sub("\n", t)
    t = _TAGS.sub(" ", t)
    t = html.unescape(t)
    t = _EMAIL.sub("[removed]", t)
    t = _HANDLE.sub("[removed]", t)
    t = t.replace("@", " at ")
    t = _PHONE.sub(_strip_phone, t)
    t = t.replace("&lt;", "<").replace("&gt;", ">")
    t = _SPACES.sub(" ", t)
    t = "\n".join(line.strip() for line in t.splitlines())
    t = _BLANKS.sub("\n\n", t).strip()
    return t or None


def fetch_missing_greenhouse(conn, get_json, cap=300, workers=8):
    """Fetch and store descriptions for Greenhouse postings that have none. Returns (fetched, failed)."""
    rows = conn.execute(
        "SELECT p.url, c.fetch_slug FROM postings p JOIN companies c ON c.slug = p.company_slug "
        "WHERE c.ats = 'greenhouse' AND p.description IS NULL ORDER BY p.first_seen, p.url"
    ).fetchall()
    todo = []
    for url, fetch_slug in rows:
        m = GH_ID.search(url or "")
        if m and fetch_slug:
            todo.append((url, fetch_slug, m.group(1)))
    if cap is not None:
        todo = todo[:cap]

    def one(item):
        url, slug, job_id = item
        status, d = get_json(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs/{job_id}")
        if status == 200 and isinstance(d, dict):
            teams = [x.get("name") for x in d.get("departments") or [] if isinstance(x, dict) and x.get("name")]
            return url, clean(d.get("content")), (teams[0] if teams else None)
        return url, None, None

    fetched = failed = 0
    with ThreadPoolExecutor(workers) as ex:
        for url, desc, team in ex.map(one, todo):
            if team:
                # The list call carries no department; this per-job call is the only place Greenhouse gives it.
                conn.execute("UPDATE postings SET team = ? WHERE url = ?", (team, url))
            if desc:
                conn.execute("UPDATE postings SET description = ? WHERE url = ?", (desc, url))
                fetched += 1
            else:
                failed += 1
    conn.commit()
    return fetched, failed

