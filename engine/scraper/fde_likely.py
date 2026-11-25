"""Will this company hire someone to deploy alongside its customers? Stdlib only.

The weekly briefing ranks funding rounds by this, because a round is only interesting to an FDE if
the company is the kind that needs people on the ground. A self-serve developer tool raising $50m is
not news to someone who deploys; a vertical AI company selling into hospitals raising $8m is.

The score is evidence, not opinion: every point names the phrase that earned it, so a ranked list can
be checked line by line. Nothing here looks at the round size alone, because a big round at a
self-serve company still hires no one to sit with a customer.

Scored out of roughly 10. Anything at 4 or more is worth a line in the briefing.

Measured 26 Sep 2026, on each company's own advert text:
  111 companies with a live core deployment role: 102 (91%) score 4 or more.
  4 companies that plainly do not hire these people: Linear 0, Supabase 1, Discord 2, Reddit 3.
    None reach the threshold.
Four negatives is a thin sample and should be grown. An earlier check that scored 90% of the board's
own companies as positives was worthless: every company on the board was seeded precisely because it
looks like an FDE employer, so it could not be a contrast set. The number that means anything is the
one against companies from outside it.

The known weakness is bland copy. Anthropic and Databricks both score 2 on their own words, because
a large company's advert says nothing about deployment. That is what `has_open_role` is for: a role
we have actually seen on their board outranks anything a description claims.
"""
import re

# The strongest signal by a distance: they already employ this shape of person.
ALREADY_HIRING = re.compile(
    r"\b(forward[\s-]*deploy\w*|deployment (?:strategist|engineer|lead|manager)|"
    r"solutions? (?:architect|engineer)|implementation (?:manager|consultant)|"
    r"professional services|customer engineer)\b", re.I)

# The work has to happen inside someone else's organisation.
ON_THE_GROUND = re.compile(
    r"\b(on[- ]?site|in the field|embed(?:ded|s|ding)? with|alongside (?:our |their )?customers?|"
    r"inside (?:the |our |their )?customers?|customer's (?:environment|systems?|site)|"
    r"deploy\w* (?:at|with|into|inside)|rollout|roll[- ]out|go[- ]live|implementation)\b", re.I)

# Sold to organisations that cannot self-serve.
ENTERPRISE = re.compile(
    r"\b(enterprise|large organisations?|large organizations?|fortune \d+|"
    r"mid[- ]market|contractors?|operators?|manufacturers?|hospitals?|banks?|insurers?|"
    r"government|public sector|utilities|carriers?|airlines?|retailers?)\b", re.I)

# The messy-integration tell: someone has to wire this into systems that already exist.
INTEGRATION = re.compile(
    r"\b(integrat\w+|legacy systems?|erp\b|ehr\b|emr\b|scada|plc\b|mes\b|cad\b|"
    r"existing (?:systems?|stack|tooling)|data (?:migration|pipelines?)|connectors?|"
    r"bespoke|custom(?:is|iz)ed? (?:workflows?|deployments?|builds?))\b", re.I)

# An industry of its own, rather than a horizontal tool.
VERTICAL = re.compile(
    r"\b(construction|healthcare|health system|life sciences|pharma|legal|insurance|banking|"
    r"defen[cs]e|military|government|manufacturing|industrial|energy|utilit\w+|logistics|freight|"
    r"supply chain|telecom\w*|education|real estate|automotive|mining|maritime|agriculture)\b", re.I)

# Counter-signals: a company whose whole point is that nobody has to deploy anything.
SELF_SERVE = re.compile(
    r"\b(self[- ]serve|self[- ]service|sign up (?:in|and)|free tier|freemium|"
    r"product[- ]led growth|plg\b|developers? can start|no sales call|instant(?:ly)? (?:set ?up|onboard)|"
    r"credit card|app store|consumer app|b2c\b)\b", re.I)

SIGNALS = [
    ("already hires this shape of person", ALREADY_HIRING, 4),
    ("work happens inside the customer", ON_THE_GROUND, 2),
    ("sells into one industry, not everyone", VERTICAL, 2),
    ("has to be wired into existing systems", INTEGRATION, 1),
    ("sells to organisations that cannot self-serve", ENTERPRISE, 1),
]


def score(text, has_open_role=False):
    """-> (score, [reasons]). `text` is whatever the company says about itself, in its own words.

    `has_open_role` is fact rather than language: we have already seen an FDE-type role on their own
    board. It is worth more than anything a description can say, so it is scored separately.
    """
    text = text or ""
    total, reasons = 0, []

    if has_open_role:
        total += 5
        reasons.append("already has a deployment role open on their own board")

    for label, rx, points in SIGNALS:
        hits = rx.findall(text)
        if not hits:
            continue
        # One phrase is a mention, several is a theme. Never more than double the base.
        weight = points if len(hits) < 3 else points * 2
        total += weight
        first = hits[0] if isinstance(hits[0], str) else next((h for h in hits[0] if h), "")
        reasons.append(f"{label} ({len(hits)}x, e.g. \"{first.strip().lower()}\")")

    penalty = len(SELF_SERVE.findall(text))
    if penalty:
        total -= min(4, penalty * 2)
        reasons.append(f"but it reads as self-serve ({penalty}x), where nobody deploys anything")

    return max(0, total), reasons


def worth_a_line(text, has_open_role=False, threshold=4):
    """Does this round earn a place in the briefing?"""
    total, reasons = score(text, has_open_role)
    return total >= threshold, total, reasons


def attach(doc, about_for, hiring=None):
    """Add `fdeLikely` to every company in the exported document, in place.

    `about_for(slug)` returns what that company says about itself. `hiring` is the set of slugs with a
    live core deployment role. A company we have no words for gets `scored: false` rather than a zero,
    because a round we cannot judge is not a round we have judged badly.
    """
    hiring = hiring or set()
    for company in doc.get("companies", []):
        slug = company.get("slug")
        about = about_for(slug) or ""
        industries = " ".join(i for i in (company.get("industries") or []) if i != "horizontal")
        has_role = slug in hiring
        total, reasons = score(f"{about} {industries}".strip(), has_open_role=has_role)
        judged = bool(about) or has_role or bool(industries)
        company["fdeLikely"] = {
            "score": total if judged else None,
            "scored": judged,
            "reasons": reasons if judged else [],
        }
    return doc
