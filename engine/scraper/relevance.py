"""Is this role actually forward deployed work: someone who deploys with customers?

Three answers, each with a stored reason so a candidate can see why a role is on the board:
  core     the job is deploying, building or leading delivery inside customer environments
  related  customer-facing but a different job (solutions engineering, pre-sales, implementation)
  off      the title matched a keyword but the work is internal (our own data centres, platform, fleet)

Rule-based on purpose: it runs on a schedule with no API key, and every verdict names its evidence.
"""
import re

from scraper.industries import strip_boilerplate

CORE, RELATED, OFF = "core", "related", "off"

# The title already told us the family (scraper.scrape.TIERS). These decide what the words mean here.
_INTERNAL_TITLE = re.compile(
    r"\b(data ?cent(?:er|re)|colocation|mechanical|electrical|hvac|facilit(?:y|ies)|capacity|"
    r"commissioning|network engineer|site reliability engineer|sre)\b", re.I)
# "Construction" in a title means opposite things depending on who is hiring. At an AI lab it is our own
# data centre being built. At a construction software company it is the customer's industry, and the job
# is deploying the product onto their sites: XYZ Reality's "Project Delivery Manager - Construction" was
# judged off the board by the title alone (19 Sep 2026), which is the exact role the board exists for.
# So it only counts as internal when the listing itself describes our own estate.
_AMBIGUOUS_INTERNAL_TITLE = re.compile(r"\b(construction|infrastructure|estate|premises)\b", re.I)
_CUSTOMER_TITLE = re.compile(r"\b(customer|client|field|partner|solutions?|implementation|onboarding|professional services)\b", re.I)

_CUSTOMER_EVIDENCE = re.compile(
    r"\b(customers?|clients?|end users|accounts?|prospects?|partners|deployments? (?:at|with|into)|"
    r"on[- ]site (?:with|at)|customer[- ]facing|user[- ]facing|pilots?|proof of concept|pocs?|"
    r"implementation|onboarding|professional services|white[- ]glove|embedded with)\b", re.I)
_INTERNAL_EVIDENCE = re.compile(
    r"\b(data ?cent(?:er|re)s?|racks?|colocation|megawatts?|cooling|hvac|generators?|switchgear|"
    r"general contractors?|commissioning|our (?:own )?(?:fleet|infrastructure|platform|clusters?)|"
    r"internal (?:platform|tooling|teams?)|capacity planning|bill of materials|construction schedule)\b", re.I)

# A delivery, implementation or engagement title is core work when the listing shows the person BUILDING
# inside the customer's environment, not just running the meeting. Plan Lab's "Delivery Lead" is the case:
# it never says forward deployed, and it names Palantir deployment strategists as the ideal background.
_DELIVERY_TITLE = re.compile(
    r"\b(delivery|implementation|engagement|onboarding|customer engineer|technical account|professional services)\b",
    re.I)
_BUILD_EVIDENCE = re.compile(
    r"\b(build|builds|building|built|implement\w*|configur\w+|integrat\w+|customis\w+|customiz\w+|prototyp\w+|"
    r"roll ?out|deploy\w*|deliver\w*)\b", re.I)

FLAG_PATTERNS = [
    ("internship", re.compile(r"\b(internship|intern|new grad|graduate programme|apprentice)\b", re.I)),
    ("leadership", re.compile(r"\b(manager|head of|director|vp|vice president|lead of|principal)\b", re.I)),
    ("pre-sales", re.compile(r"\b(pre[- ]sales|presales|sales engineer)\b", re.I)),
    ("clearance", re.compile(r"\b(clearance|ts/sci|top secret|dv cleared|developed vetting)\b", re.I)),
]

MIN_EVIDENCE = 2


def flags(title, description=None):
    text = f"{title or ''}\n{description or ''}"
    return [name for name, rx in FLAG_PATTERNS if rx.search(text)]


def _counts(description):
    """How many sentences talk about customer work, and how many about our own estate.

    Counted per sentence, outside benefits and equal-opportunity boilerplate, so one "customers" in a
    company blurb does not make a role customer-facing, and a long list of duties counts once each.
    """
    customer = internal = 0
    for sentence in strip_boilerplate(description):
        if _CUSTOMER_EVIDENCE.search(sentence):
            customer += 1
        if _INTERNAL_EVIDENCE.search(sentence):
            internal += 1
    return customer, internal


def _builds_for_customers(description):
    """Sentences that talk about building, configuring or rolling something out for a customer."""
    return sum(1 for s in strip_boilerplate(description)
               if _BUILD_EVIDENCE.search(s) and _CUSTOMER_EVIDENCE.search(s))


def _internal_word(title):
    """The word that made a title read as internal, for the stored reason."""
    hit = _INTERNAL_TITLE.search(title) or _AMBIGUOUS_INTERNAL_TITLE.search(title)
    return hit.group(0).lower() if hit else "internal"


def classify(title, description=None, tier=None):
    """-> (relevance, reason). `tier` is the title family from scraper.scrape.TIERS."""
    title = title or ""
    customer_hits, internal_hits = _counts(description)
    internal_title = bool(_INTERNAL_TITLE.search(title)) or bool(
        _AMBIGUOUS_INTERNAL_TITLE.search(title) and internal_hits >= MIN_EVIDENCE)
    customer_title = bool(_CUSTOMER_TITLE.search(title))
    forward = bool(re.search(r"forward[\s-]*deploy", title, re.I))

    if forward:
        # "Forward deployed" says it on the tin, including Forward Deployed Infrastructure Engineer and SRE.
        # Only a listing that is clearly about our own estate overrides the title.
        if internal_hits >= MIN_EVIDENCE and internal_hits > customer_hits:
            return OFF, f"forward deployed in the title, but the listing is internal infrastructure ({internal_hits} mentions)"
        return CORE, "the title says forward deployed"
    if tier in ("fde", "deployment"):
        if internal_title and not customer_title:
            return OFF, f"the title is internal infrastructure work ({_internal_word(title)})"
        if internal_hits >= MIN_EVIDENCE and internal_hits > customer_hits:
            return OFF, f"the listing describes internal infrastructure ({internal_hits} mentions, customers {customer_hits})"
        if customer_hits >= MIN_EVIDENCE or customer_title or not description:
            return CORE, (f"a deployment title, and the listing describes customer work ({customer_hits} sentences)"
                          if customer_hits else "the title is a deployment role")
        return RELATED, f"a deployment title, but the listing barely mentions customers ({customer_hits} sentences)"
    # Adjacent titles: solutions engineers, delivery and implementation managers.
    if internal_title and not customer_title:
        return OFF, f"the title is internal infrastructure work ({_internal_word(title)})"
    if internal_hits >= MIN_EVIDENCE and internal_hits > customer_hits:
        return OFF, f"the listing describes internal infrastructure ({internal_hits} mentions, customers {customer_hits})"
    if _DELIVERY_TITLE.search(title):
        built = _builds_for_customers(description)
        if built >= MIN_EVIDENCE:
            return CORE, f"a delivery title, and the listing describes building inside customer environments ({built} sentences)"
    if customer_hits >= MIN_EVIDENCE or (customer_title and customer_hits):
        return RELATED, f"customer-facing, but not a deployment title ({customer_hits} sentences about customers)"
    if customer_title and not description:
        return RELATED, "a customer-facing title, no listing text to check"
    return OFF, "no evidence the work happens with customers"
