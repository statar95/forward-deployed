"""What a company has just announced, from its own feed. Stdlib only.

A candidate writing to a hiring manager needs a reason to write *this week*. "You just launched X" is
that reason, and the specifics are the whole product: outreach tips without them are worthless.

Two rules, the same ones the funding data follows:
- **The company's own domain, or nothing.** Not an aggregator, not a news site, not a press release
  wire that rewrites the headline. If it is not on their site it does not appear.
- **Headline, date and link only.** Never the body. The article is their copyrighted text, exactly as
  a job description is, and the board has never republished one of those either.

Feeds are found by trying the handful of paths a site actually uses. Most publish RSS or Atom without
advertising it; a site that publishes neither simply has no news line, which is a blank space rather
than a guess.
"""
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

# The paths that actually exist, in the order they are worth trying.
FEED_PATHS = ("/blog/rss.xml", "/blog/feed.xml", "/blog/rss", "/blog/feed", "/rss.xml", "/feed.xml",
              "/feed", "/rss", "/news/rss.xml", "/blog/index.xml", "/atom.xml", "/blog/atom.xml",
              # Found by hand 30 Sep: Vercel and Augury publish at a bare /atom.
              "/atom", "/blog.xml", "/news/feed")

# A <link rel="alternate" type="application/rss+xml" href="..."> on the home page beats guessing.
FEED_LINK = re.compile(
    r'<link[^>]+type=["\']application/(?:rss|atom)\+xml["\'][^>]*>', re.I)
HREF = re.compile(r'href=["\']([^"\']+)["\']', re.I)

_DATE_FORMATS = (
    "%a, %d %b %Y %H:%M:%S %z",   # RSS
    "%a, %d %b %Y %H:%M:%S %Z",
    "%Y-%m-%dT%H:%M:%S%z",        # Atom
    "%Y-%m-%dT%H:%M:%SZ",
    "%Y-%m-%d",
)


def feed_candidates(domain, home_html=None):
    """Feed URLs worth trying for a domain, the declared one first."""
    base = f"https://{domain.strip().strip('/')}"
    out = []
    for tag in FEED_LINK.findall(home_html or ""):
        href = HREF.search(tag)
        if not href:
            continue
        url = href.group(1)
        if url.startswith("//"):
            url = "https:" + url
        elif url.startswith("/"):
            url = base + url
        elif not url.startswith("http"):
            url = f"{base}/{url}"
        out.append(url)
    out.extend(base + p for p in FEED_PATHS)
    seen, unique = set(), []
    for u in out:
        if u not in seen:
            seen.add(u)
            unique.append(u)
    return unique


def _text(node):
    return re.sub(r"\s+", " ", "".join(node.itertext())).strip() if node is not None else ""


def _parse_date(raw):
    raw = (raw or "").strip()
    for fmt in _DATE_FORMATS:
        try:
            dt = datetime.strptime(raw, fmt)
            return dt.date().isoformat()
        except ValueError:
            continue
    # Some feeds put a full ISO timestamp with fractional seconds or an offset like +00:00.
    m = re.match(r"(\d{4}-\d{2}-\d{2})", raw)
    return m.group(1) if m else None


def parse(xml_text, domain=None):
    """-> [{title, url, date}], newest first. Items not on the company's own domain are dropped."""
    try:
        root = ET.fromstring((xml_text or "").strip())
    except ET.ParseError:
        return []

    items = []
    # RSS puts entries at channel/item; Atom uses {ns}entry. Tag names are namespaced in Atom.
    for node in root.iter():
        tag = node.tag.rsplit("}", 1)[-1].lower()
        if tag not in ("item", "entry"):
            continue
        title = url = date = None
        for child in node:
            name = child.tag.rsplit("}", 1)[-1].lower()
            if name == "title" and not title:
                title = _text(child)
            elif name == "link" and not url:
                url = (child.get("href") or _text(child) or "").strip()
            elif name in ("pubdate", "published", "updated", "date") and not date:
                date = _parse_date(_text(child))
        if not title or not url:
            continue
        if domain and domain.replace("www.", "") not in url.replace("www.", ""):
            continue  # their own site, or it does not appear
        items.append({"title": title[:160], "url": url, "date": date})

    items.sort(key=lambda i: i["date"] or "", reverse=True)
    return items


def fresh(items, days=90, today=None):
    """Only recent items are a reason to write to someone. Undated items are dropped, not guessed."""
    today = today or datetime.now(timezone.utc).date()
    cutoff = (today - timedelta(days=days)).isoformat()
    return [i for i in items if i["date"] and i["date"] >= cutoff]


def attach(doc, by_slug, limit=2):
    """Add `news` to every company in the exported document, in place."""
    for company in doc.get("companies", []):
        company["news"] = (by_slug.get(company.get("slug")) or [])[:limit]
    return doc


# Most company blogs are two things wearing one coat: announcements, and search-engine content. A
# candidate can open a conversation with "you just signed X". Nobody opens one with "9 ways to use
# our agent plugin". Measured on 988 real headlines from 31 company feeds, 26 Sep 2026.
ANNOUNCEMENT = re.compile(
    r"\b(launch\w*|introduc\w+|announc\w+|unveil\w*|debut\w*|releas\w+|"
    r"rais\w+|funding round|series [a-f]\b|seed round|acqui\w+|merge[rs]?\b|"
    r"partner\w*|teams? up|collaborat\w+|joins? forces|"
    r"select(?:s|ed)?\b|awarded|wins?\b|secures?\b|contract\b|deal\b|"
    r"now (?:available|live|generally)|general availability|expand\w+|opens? (?:an? )?(?:office|hq)|"
    r"appoint\w*|names? (?:new )?(?:ceo|cto|coo|cfo|chief|head|vp)|hires?\b|"
    r"certif\w+|compliant|approval|cleared|milestone|world\'?s first|industry\'?s first|first[- ]ever)", re.I)

# The tells of something written for a search engine rather than to say news.
MARKETING = re.compile(
    r"^(how to\b|how we\b|why we\b|what is\b|what are\b|a guide\b|the guide\b|meet \w+:|"
    r"\d+ (?:ways|tips|things|reasons|steps|lessons)\b|top \d+|best practices|case study)"
    r"|\b(?:a |the )?(?:complete |ultimate |practical )?guide (?:to|for)\b"
    r"|\b(?:best practices|playbook|checklist|webinar|recap|cheat sheet|tutorial|explained|a conversation with|in conversation|q&a with|interview with|meet the team)\b", re.I)


def announcements(items):
    """Only the items a candidate could open a conversation with.

    Deliberately strict. A news line that says "Hiring Employees in Austria: A Guide for Employers"
    is worse than a blank one: it makes the board look like it is padding, and it gives a candidate
    nothing to say.
    """
    out = []
    for i in items:
        title = i.get("title") or ""
        if MARKETING.search(title):
            continue
        if not ANNOUNCEMENT.search(title):
            continue
        out.append(i)
    return out
