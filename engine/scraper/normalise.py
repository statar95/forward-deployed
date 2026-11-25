"""Title and location normalisation, so the same role posted in 12 cities becomes one role.

Stdlib only. The rule for titles: only strip a trailing segment when every part of it is a
place (city, country, region) or a work-mode word. Industry words (Healthcare, US Government)
and seniority words (New Grad, Manager) are never stripped.
"""
import re

# Lower-case places seen in the 16 Sep snapshot titles and locations, plus common neighbours.
PLACES = {
    # US
    "sf", "sfo", "san francisco", "bay area", "sf bay area", "nyc", "ny", "new york", "new york city",
    "seattle", "boston", "chicago", "austin", "denver", "los angeles", "la", "washington", "washington dc",
    "washington d.c.", "dc", "d.c.", "dmv", "atlanta", "miami", "dallas", "houston", "san diego",
    "palo alto", "mountain view", "menlo park", "san jose", "salt lake city", "philadelphia", "arlington",
    "reston", "huntsville", "colorado springs", "costa mesa", "el segundo", "portland",
    # Europe
    "london", "uk", "united kingdom", "england", "dublin", "ireland", "paris", "france", "munich", "berlin",
    "germany", "amsterdam", "netherlands", "madrid", "barcelona", "spain", "lisbon", "portugal", "milan",
    "rome", "italy", "zurich", "switzerland", "stockholm", "sweden", "copenhagen", "denmark", "oslo",
    "norway", "helsinki", "finland", "warsaw", "poland", "vilnius", "lithuania", "prague", "vienna",
    "brussels", "belgium", "edinburgh", "manchester", "cambridge", "oxford",
    # Asia Pacific, Middle East, Americas
    "tokyo", "japan", "seoul", "korea", "south korea", "singapore", "sydney", "melbourne", "australia",
    "bengaluru", "bangalore", "mumbai", "delhi", "new delhi", "hyderabad", "pune", "chennai", "india",
    "hong kong", "taipei", "taiwan", "jakarta", "manila", "bangkok", "shanghai", "beijing",
    "tel aviv", "israel", "dubai", "abu dhabi", "uae", "united arab emirates", "riyadh", "saudi arabia",
    "doha", "qatar", "toronto", "vancouver", "montreal", "canada", "sao paulo", "são paulo", "brazil",
    "mexico city", "mexico", "buenos aires", "bogota", "nairobi", "lagos", "cape town", "johannesburg",
    # Countries and regions
    "us", "usa", "u.s.", "united states", "north america", "americas", "latam", "emea", "apac", "apj",
    "europe", "eu", "asia", "southeast asia", "sea", "anz", "middle east", "mena", "dach", "nordics",
    "benelux", "global", "international remote", "east coast", "west coast", "us east", "us west",
}
WORK_MODES = {"remote", "hybrid", "onsite", "on-site", "in-office", "in office", "anywhere", "fully remote"}

US_STATES = {
    "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id", "il", "in", "ia", "ks", "ky",
    "la", "me", "md", "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd",
    "oh", "ok", "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy", "dc",
}

COUNTRY_ALIASES = {
    "us": "United States", "usa": "United States", "u.s.": "United States", "united states": "United States",
    "united states of america": "United States", "uk": "United Kingdom", "gb": "United Kingdom",
    "great britain": "United Kingdom", "england": "United Kingdom", "united kingdom": "United Kingdom",
    "fr": "France", "de": "Germany", "nl": "Netherlands", "es": "Spain", "it": "Italy", "ie": "Ireland",
    "ch": "Switzerland", "se": "Sweden", "dk": "Denmark", "no": "Norway", "fi": "Finland", "pl": "Poland",
    "lt": "Lithuania", "pt": "Portugal", "be": "Belgium", "at": "Austria", "jp": "Japan", "kr": "South Korea",
    "korea": "South Korea", "sg": "Singapore", "au": "Australia", "in": "India", "ca": "Canada",
    "il": "Israel", "ae": "United Arab Emirates", "uae": "United Arab Emirates", "br": "Brazil",
    "mx": "Mexico", "hk": "Hong Kong", "tw": "Taiwan", "cn": "China", "nz": "New Zealand",
    "sa": "Saudi Arabia",
}
COUNTRY_NAMES = {
    "France", "Germany", "Netherlands", "Spain", "Italy", "Ireland", "Switzerland", "Sweden", "Denmark",
    "Norway", "Finland", "Poland", "Lithuania", "Portugal", "Belgium", "Austria", "Japan", "South Korea",
    "Singapore", "Australia", "India", "Canada", "Israel", "United Arab Emirates", "Brazil", "Mexico",
    "Hong Kong", "Taiwan", "China", "New Zealand", "Saudi Arabia", "Czech Republic", "Romania", "Greece",
    "Argentina", "Colombia", "Chile", "Kenya", "Nigeria", "South Africa", "Philippines", "Indonesia",
    "Thailand", "Vietnam", "Malaysia", "Qatar", "United States", "United Kingdom",
}
CITY_COUNTRY = {
    "san francisco": "United States", "sf": "United States", "nyc": "United States",
    "new york": "United States", "new york city": "United States", "seattle": "United States",
    "boston": "United States", "chicago": "United States", "austin": "United States",
    "washington": "United States", "washington dc": "United States", "washington d.c.": "United States",
    "los angeles": "United States", "denver": "United States", "palo alto": "United States",
    "london": "United Kingdom", "edinburgh": "United Kingdom", "manchester": "United Kingdom",
    "paris": "France", "munich": "Germany", "berlin": "Germany", "amsterdam": "Netherlands",
    "madrid": "Spain", "barcelona": "Spain", "dublin": "Ireland", "zurich": "Switzerland",
    "stockholm": "Sweden", "copenhagen": "Denmark", "oslo": "Norway", "vilnius": "Lithuania",
    "tokyo": "Japan", "seoul": "South Korea", "singapore": "Singapore", "sydney": "Australia",
    "melbourne": "Australia", "bengaluru": "India", "bangalore": "India", "mumbai": "India",
    "toronto": "Canada", "vancouver": "Canada", "tel aviv": "Israel", "dubai": "United Arab Emirates",
    "abu dhabi": "United Arab Emirates",
}

_DASHES = re.compile(r"\s+[—–]\s+")
_BARE_DASH = re.compile(r"[—–]")
_SPACES = re.compile(r"\s+")
# Separators a trailing location can hang off, most specific first.
_TRAIL = [
    re.compile(r"^(?P<head>.+?)\s*\((?P<seg>[^()]+)\)\s*$"),
    re.compile(r"^(?P<head>.+)\s+[-|/@]\s+(?P<seg>[^-|]+)$"),
    re.compile(r"^(?P<head>.+?),\s*(?P<seg>[^,]+)$"),
    re.compile(r"^(?P<head>.+\w)-(?P<seg>[A-Za-z][A-Za-z .]*)$"),
    re.compile(r"^(?P<head>.+?)\s+\|\s*(?P<seg>.+)$"),
]


def title_display(title):
    t = (title or "").replace("\t", " ").strip()
    t = _DASHES.sub(", ", t)
    t = _BARE_DASH.sub("-", t)
    return _SPACES.sub(" ", t).strip()


def _is_place_piece(piece):
    p = piece.strip().strip(".").lower()
    if not p:
        return True
    if p in PLACES or p in WORK_MODES:
        return True
    words = p.split()
    # "Remote US", "US Remote", "Hybrid London": work-mode word plus a place.
    if len(words) > 1 and (words[0] in WORK_MODES or words[-1] in WORK_MODES):
        rest = " ".join(w for w in words if w not in WORK_MODES)
        return rest in PLACES
    return False


def is_location_segment(seg):
    parts = re.split(r"\s*(?:/|,|;|&|\+|\bor\b|\band\b)\s*", seg.strip(), flags=re.I)
    parts = [p for p in parts if p.strip()]
    return bool(parts) and all(_is_place_piece(p) for p in parts)


def normalise_title(title):
    t = title_display(title)
    for _ in range(4):
        for rx in _TRAIL:
            m = rx.match(t)
            if m and is_location_segment(m.group("seg")) and len(m.group("head").strip()) >= 3:
                t = m.group("head").strip().rstrip(",-|/ ").strip()
                break
        else:
            break
    return t


def slugify(text):
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower())
    return s.strip("-")


def role_key(company_slug, title_norm):
    return f"{company_slug}:{slugify(title_norm)}"


def country_name(value):
    if not value:
        return None
    v = value.strip()
    alias = COUNTRY_ALIASES.get(v.lower())
    if alias:
        return alias
    return v if v in COUNTRY_NAMES else None


def parse_location(location, country=None):
    """Return {city, country, remote}. `country` is the ATS's own country field when it has one."""
    raw = (location or "").strip()
    low = raw.lower()
    remote = True if ("remote" in low or "anywhere" in low) else None
    found_country = country_name(country)
    city = None
    parts = [p.strip() for p in re.split(r"\s*[,|;]\s*", raw) if p.strip()]
    cleaned = [p for p in parts if p.lower() not in WORK_MODES and p.lower() not in ("remote", "hybrid")]
    if cleaned:
        first = re.sub(r"(?i)\b(remote|hybrid)\b", "", cleaned[0]).strip(" -()")
        last = cleaned[-1]
        if not found_country:
            if len(cleaned) > 1 and last.lower() in US_STATES:
                found_country = "United States"
            else:
                found_country = country_name(last) or country_name(first)
        if first and not country_name(first):
            city = first
            if not found_country:
                found_country = CITY_COUNTRY.get(first.lower())
    return {"city": city, "country": found_country, "remote": remote}
