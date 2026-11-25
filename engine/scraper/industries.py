"""Industry taxonomy and keyword table. Rule-based on purpose: explainable and runs with no API key.

`tag_role` tags a role from its title first, then its description (boilerplate removed).
Keywords are matched as whole words, case-insensitive. Only explicit evidence counts.
"""
import re

TAXONOMY = [
    "horizontal", "construction", "healthcare", "life-sciences", "legal", "finance", "insurance",
    "government", "defence", "retail", "media", "manufacturing", "energy", "logistics",
    "telecoms", "education", "real-estate", "automotive",
]

KEYWORDS = {
    "construction": ["construction", "aec", "built environment", "infrastructure projects", "general contractors",
                     "building materials", "architecture engineering and construction", "contech"],
    "healthcare": ["healthcare", "health care", "health", "healthtech", "clinical", "clinicians", "hospital",
                   "hospitals", "medical", "patient", "patients", "payer", "payers", "health systems", "ehr"],
    "life-sciences": ["life sciences", "life science", "pharma", "pharmaceutical", "biotech", "biopharma"],
    "legal": ["legal", "law firm", "law firms", "litigation", "lawyers", "attorneys", "legal work", "legal industry",
              "legal services", "legal teams"],
    "finance": ["financial services", "finance", "fintech", "banking", "bank", "banks", "capital markets",
                "asset management", "wealth management", "private equity", "hedge fund", "hedge funds", "payments",
                "investment bank", "investment banks", "investment banking",
                "fsi"],
    "insurance": ["insurance", "insurtech", "underwriting", "insurers"],
    "government": ["government", "gov", "usg", "public sector", "federal", "civilian", "state and local", "sled", "slg",
                   "nonprofit", "non-profit", "sovereign"],
    "defence": ["defense", "defence", "national security", "dod", "intelligence community", "intel", "military"],
    "retail": ["retail", "ecommerce", "e-commerce", "consumer goods", "cpg"],
    "media": ["media", "entertainment", "games", "gaming"],
    "manufacturing": ["manufacturing", "manufacturers", "factory", "factories"],
    "energy": ["energy", "utilities", "oil and gas", "oil, gas", "oil & gas"],
    "logistics": ["freight", "logistics industry", "logistics companies", "logistics providers", "3pl"],
    "telecoms": ["telecom", "telecoms", "telecommunications", "telco"],
    "education": ["education", "edtech", "higher education", "k-12"],
    "real-estate": ["real estate", "proptech"],
    "automotive": ["automotive"],
}

# Words that look like a vertical in a title but describe a customer segment, not an industry.
IGNORED = [
    "enterprise", "startups", "startup", "digital natives", "digital native", "mid-market", "smb", "strategic",
    "commercial", "international", "growth", "platform", "cyber", "cybersecurity", "high-tech",
]

# Sentences in a description that mention industry words for reasons unrelated to the role:
# benefits, equal opportunity statements, pay transparency, public holidays.
BOILERPLATE = re.compile(
    r"equal opportunit|eeo\b|veteran|protected (?:by|characteristic|class)|discriminat|applicable (?:federal|law)|"
    r"benefit|insurance plan|health insurance|life insurance|dental|vision|401\s*\(?k|parental leave|pto\b|"
    r"bank holiday|wellness|pay transparency|salary range|compensation|e-verify|reasonable accommodation|"
    r"military status|military spouse|background check|privacy notice|candidate privacy|stipend|membership|"
    r"perks|private medical|virtual care|fertility|pet insurance|\bhra\b|paid time off|holidays|export|itar\b|"
    r"citizen|permanent resident|asylee|refugee|visa sponsorship|minimum education|degree|"
    # Company pitches naming who they sell to, repeated on every role at that company.
    r"we partner with|we work closely with|industry leaders like|customers (?:like|include)|trusted by|backed by|"
    r"salar(?:y|ies)|medical plan|\bhsa\b|\bfsa\b|fraud|financial request|banking information",
    re.I,
)
# Non-English descriptions: English keywords mean something else ("construction" in French is "building").
_NON_ENGLISH = re.compile(r"\b(?:vous|nous|avec|pour|les|des|und|wir|mit|für|para|con|los|las)\b", re.I)
NON_ENGLISH_MIN = 15
_SENTENCES = re.compile(r"(?<=[.!?])\s+|\n+|\s+[-•*]\s+")
# A sentence naming this many industries is a list of sectors ("clients across government, finance, retail"),
# which says nothing about the role.
SECTOR_LIST = 3
MIN_DESCRIPTION_HITS = 2
# More industries than this from one description is a company pitch, not a role; only strong ones survive.
MAX_DESCRIPTION_INDUSTRIES = 2
STRONG_DESCRIPTION_HITS = 4
# Words that name a vertical in a title ("FDE, Legal") but usually a team or function in a description
# ("work with legal, policy and security", "calls with procurement, finance and IT").
TITLE_ONLY = {"legal", "finance", "health", "media", "energy", "factory", "factories"}

# "horizontal" (sells across industries) is a company tag only; no title keyword implies it.
_PATTERNS = {
    ind: re.compile(r"(?<!\w)(?:" + "|".join(re.escape(k) for k in sorted(kws, key=len, reverse=True))
                    + r")(?!\w)", re.I)
    for ind, kws in KEYWORDS.items()
}


def industries_in(text):
    """Industries with explicit keyword evidence in `text`, in TAXONOMY order."""
    if not text:
        return []
    return [ind for ind in TAXONOMY if ind in _PATTERNS and _PATTERNS[ind].search(text)]


def title_hits(title):
    return set(industries_in(title))


def strip_boilerplate(description):
    """Description sentences with benefits, equal-opportunity and similar boilerplate removed."""
    text = re.sub(r"\bU\.S\.", "US", description or "")
    text = re.sub(r"https?://\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:gov|com|org|io)\b\S*", " ", text)
    return [s for s in _SENTENCES.split(text) if s and s.strip() and not BOILERPLATE.search(s)]


def tag_role(title, description=None):
    """-> (industries, source).

    A title match wins. Otherwise an industry counts from the description when it is named at least twice,
    outside boilerplate and outside sentences that list several sectors. A description that yields more
    than two industries is a company pitch: only industries named in at least four sentences survive, and if
    that is still more than two, nothing is tagged.
    """
    hits = industries_in(title)
    if hits:
        return hits, "title"
    if description and len(_NON_ENGLISH.findall(description)) >= NON_ENGLISH_MIN:
        return [], None
    counts = {}
    for sentence in strip_boilerplate(description):
        found = industries_in(sentence)
        if len(found) >= SECTOR_LIST:
            continue
        for ind in found:
            words = {m.lower() for m in _PATTERNS[ind].findall(sentence)} - TITLE_ONLY
            if words:
                counts[ind] = counts.get(ind, 0) + 1  # one per sentence: two mentions must be two sentences
    tagged = [ind for ind in TAXONOMY if counts.get(ind, 0) >= MIN_DESCRIPTION_HITS]
    if len(tagged) > MAX_DESCRIPTION_INDUSTRIES:
        tagged = [ind for ind in tagged if counts[ind] >= STRONG_DESCRIPTION_HITS]
        if len(tagged) > MAX_DESCRIPTION_INDUSTRIES:
            tagged = []
    return (tagged, "description") if tagged else ([], None)
