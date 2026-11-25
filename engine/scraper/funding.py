"""Funding rounds shown on the site. Stdlib only.

Two rules, both about what may be published:
- Every round comes from `seeds/funding.csv`, and every row there carries the public page it was read from
  (company announcement, press wire or press). A row without one is never loaded.
- Data aggregators are never a source.

Tier-1 marks come from `seeds/investors.csv`, a hand-picked list of funds, matched on whole names or listed aliases.
"""
import csv
import re
from datetime import date, datetime
from urllib.parse import urlsplit

AGGREGATORS = ("pitchbook.com", "crunchbase.com", "tracxn.com", "cbinsights.com", "dealroom.co", "clay.com",
               "growjo.com", "linkedin.com", "wikipedia.org", "owler.com", "zoominfo.com", "golden.com")


def _split(s):
    return [x.strip() for x in (s or "").split(";") if x.strip()]


def _norm(name):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9& ]", " ", (name or "").lower())).strip()


def load(path):
    """-> (rows, rejected [(slug, reason)]). Only rows that may be shown publicly survive."""
    rows, rejected = [], []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            slug = (r.get("company_slug") or "").strip()
            url = (r.get("source_url") or "").strip()
            if not slug:
                continue
            if not url.startswith(("https://", "http://")):
                rejected.append((slug, "no source_url"))
                continue
            host = urlsplit(url).hostname or ""
            if any(host == a or host.endswith("." + a) for a in AGGREGATORS):
                rejected.append((slug, "aggregator source"))
                continue
            try:
                datetime.strptime(r.get("announced_on") or "", "%Y-%m-%d")
            except ValueError:
                rejected.append((slug, "no announced_on"))
                continue
            rows.append(r)
    return rows, rejected


def load_investors(path):
    """{normalised name or alias: canonical name} for tier-1 funds."""
    out = {}
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            if (r.get("tier") or "").strip() != "1":
                continue
            for n in [r["name"], *_split(r.get("aliases"))]:
                out[_norm(n)] = r["name"]
    return out


def tier_one(name, investors):
    """The tier-1 fund this investor name is, or None. Whole names only: "Insight" is Insight Partners,
    "Insight Venture Capital Fund of Kenya" is not."""
    return investors.get(_norm(name))


def by_company(rows, investors, today=None):
    """Latest round per company, shaped for the export."""
    today = datetime.strptime(today, "%Y-%m-%d").date() if today else date.today()
    latest = {}
    for r in rows:
        slug = r["company_slug"].strip()
        if slug not in latest or r["announced_on"] > latest[slug]["announced_on"]:
            latest[slug] = r
    out = {}
    for slug, r in latest.items():
        backer = lambda n: {"name": n, "tier1": bool(tier_one(n, investors)), "fund": tier_one(n, investors)}  # noqa: E731
        leads = [backer(n) for n in _split(r.get("lead_investors"))]
        lead_names = {x["name"] for x in leads}
        others = [backer(n) for n in _split(r.get("investors"))]
        investors_all = leads + [x for x in others if x["name"] not in lead_names]
        amount = (r.get("amount") or "").strip()
        announced = datetime.strptime(r["announced_on"], "%Y-%m-%d").date()
        out[slug] = {
            "round": (r.get("round") or "").strip() or None,
            "amount": int(float(amount)) if amount else None,
            "currency": (r.get("currency") or "").strip() or None,
            "announcedOn": r["announced_on"],
            "daysAgo": (today - announced).days,
            "leads": leads,
            "investors": investors_all,
            "tier1": any(x["tier1"] for x in investors_all),
            "sourceUrl": r["source_url"].strip(),
        }
    return out


def attach(doc, funded):
    """Add each company's latest round to the exported document, in place."""
    for company in doc["companies"]:
        company["funding"] = funded.get(company["slug"])
    doc["counts"]["fundedLast90"] = sum(1 for f in funded.values() if f["daysAgo"] <= 90)
    return doc
