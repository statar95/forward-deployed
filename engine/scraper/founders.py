"""One founder or chief executive per company, for the "who to talk to" line. Stdlib only.

The rule this file enforces is the people-data rule from docs/vision.md: we publish one fact a company
states about itself, on a page anyone can open, and never anything assembled from a directory of people.
So a row without a `source_url` is dropped, and LinkedIn, Crunchbase and the other people databases are
refused as sources even when the fact is true.
"""
import csv
from urllib.parse import urlsplit

DIRECTORIES = ("linkedin.com", "crunchbase.com", "pitchbook.com", "zoominfo.com", "rocketreach.co",
               "apollo.io", "signalhire.com", "owler.com", "tracxn.com", "cbinsights.com", "clay.com")


def load(path, own_domains=None):
    """-> (rows, rejected [(slug, reason)]). Only rows that may be shown publicly survive.

    `own_domains` maps a company slug to its website. A banned domain is only banned as a source about
    someone else: clay.com is a data aggregator we refuse, and also Clay's own about page.
    """
    rows, rejected = [], []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            slug = (r.get("company_slug") or "").strip()
            url = (r.get("source_url") or "").strip()
            if not slug or not (r.get("person") or "").strip():
                continue
            if not url.startswith(("https://", "http://")):
                rejected.append((slug, "no source_url"))
                continue
            host = urlsplit(url).hostname or ""
            own = ((own_domains or {}).get(slug) or "").lower().lstrip("www.")
            theirs = bool(own) and (host == own or host.endswith("." + own))
            if not theirs and any(host == d or host.endswith("." + d) for d in DIRECTORIES):
                rejected.append((slug, "people directory"))
                continue
            rows.append(r)
    return rows, rejected


def by_company(rows):
    """The last row wins, so a correction is one more line in the file."""
    out = {}
    for r in rows:
        out[r["company_slug"].strip()] = {
            "name": r["person"].strip(),
            "title": (r.get("title") or "").strip() or None,
            "sourceUrl": r["source_url"].strip(),
        }
    return out


def attach(doc, people):
    for company in doc["companies"]:
        company["founder"] = people.get(company["slug"])
    return doc
