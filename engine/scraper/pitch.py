"""One line on what a company actually does, in its own words. Stdlib only.

A funding line without it says nothing to a reader: "Wonderful, Series C, $550m" is a number. With
it, "Wonderful builds AI agents that answer customer calls for banks and utilities" is the reason to
care, and the reason someone might want to go and work there.

**It comes from the company's own advert, never from anyone else's newsletter.** The daily VC
newsletters write their own one-line summaries and those sentences are their work product. We have a
better source anyway: every company on the board has told us what it does, at length, on its own job
board, and that text is already stored.

The extraction is deliberately dumb. It looks for the sentence where the company introduces itself
("Acme is the...", "At Acme, we build..."), and if there is not a clean one it returns nothing rather
than the first sentence it can find, because a wrong line is worse than a blank one.
"""
import re

# "Acme is ...", "Acme builds ...", "Acme helps ...". The verb list is what companies actually use.
VERBS = (r"is|are|was|builds?|building|makes?|helps?|provides?|powers?|gives?|delivers?|creates?|"
         r"develops?|offers?|enables?|automates?|transforms?|replaces?|runs?|connects?")

BOILERPLATE = re.compile(
    r"\b(equal opportunit|we are committed to|regardless of race|benefits include|401\(?k\)?|"
    r"visa sponsor|salary rang|compensation rang|apply now|click here|cookie|"
    # Magentic's line came back as "Compensation and Benefits At Magentic, we recognise and reward
    # the talent that drives our success", which is a benefits heading, not a description.
    r"compensation and benefits|perks and benefits|recognise and reward|recognize and reward|"
    r"we offer a competitive|holiday allowance|pension)\b", re.I)

# A pitch should read like a description, not like a job advert or a slogan.
BAD_START = re.compile(r"^(you|we are looking|this role|the role|as an?|join us|our mission is simply)\b", re.I)


# Adverts are full of headings with no full stop after them ("ABOUT ATIRA", "WHY AUCTOR"), so a
# sentence splitter glues the heading onto the sentence that follows: "ABOUT ATIRA Atira builds the
# commercial brain for industrials." Strip a leading run of shouting.
HEADING = re.compile(r"^(?:[A-Z][A-Z0-9&'/-]*\s+){1,14}(?=[A-Z][a-z])")
# The same trick in title case: "About Chalk Chalk is building..." and "About Arize AI is...".
LEAD_IN = re.compile(r"^(?:about|why|who we are|our story|overview|the company)\b[:\s]+", re.I)


def _strip_heading(s, name=None):
    s = HEADING.sub("", s).strip()
    s = LEAD_IN.sub("", s).strip()
    # "About Chalk Chalk is building" leaves "Chalk Chalk is building" once the lead-in is gone.
    if name:
        first = re.escape(name.split()[0])
        s = re.sub(rf"^(?:{re.escape(name)}|{first})\s+(?=(?:{re.escape(name)}|{first})\b)", "", s, count=1, flags=re.I)
    return s.strip()


def _mostly_shouting(s):
    letters = [ch for ch in s if ch.isalpha()]
    return bool(letters) and sum(ch.isupper() for ch in letters) / len(letters) > 0.6


def _sentences(text, name=None):
    for raw in re.split(r"(?<=[.!?])\s+", re.sub(r"\s+", " ", text or "")):
        s = _strip_heading(raw.strip(), name)
        if _mostly_shouting(s):
            continue  # a slogan in caps is not a description
        if 40 <= len(s) <= 300 and not BOILERPLATE.search(s):
            yield s


def pitch(text, name):
    """-> a single sentence describing the company, or None.

    `name` is the company's name, because the sentence we want is the one that names it.
    """
    if not text or not name:
        return None
    # "Scale AI" should also match a listing that only ever writes "Scale".
    first = re.escape(name.split()[0])
    full = re.escape(name)
    introduces = re.compile(
        rf"\b(?:{full}|{first})\b\s+(?:{VERBS})\b|\bat\s+(?:{full}|{first})\b[,\s]", re.I)

    for s in _sentences(text, name):
        if BAD_START.search(s):
            continue
        if not introduces.search(s):
            continue
        # A sentence that is mostly about the reader's job is not a description of the company.
        if re.search(r"\byou(?:'ll| will| are)\b", s, re.I):
            continue
        return s.rstrip(".") + "."
    return None


def attach(doc, about_for, limit=200):
    """Add `pitch` to every company in the exported document, in place."""
    for company in doc.get("companies", []):
        text = about_for(company.get("slug")) or ""
        line = pitch(text, company.get("name") or "")
        company["pitch"] = line[:limit] if line else None
    return doc
