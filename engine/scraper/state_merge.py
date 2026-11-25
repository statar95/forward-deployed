"""Merge the two state files two refresh runs can both write. Stdlib only.

CI runs every three hours and can be dispatched by hand, so two runs can overlap. Both regenerate
`public/data/roles.json`, `engine/first_seen.json` and `engine/history.json`, so the loser's push is
rejected and the rebase hits a conflict in every one of them. That is not a real conflict: nobody
edits these by hand, they are derived from a scrape. But "take mine" is wrong too, because
first_seen and the closed log accumulate, and overwriting would quietly lose what the other run saw.

So each file is merged by what it means:
  roles.json   a complete snapshot of one scrape. The newer scrape wins whole; mixing two is nonsense.
  first_seen   the earliest date wins per key. A role does not become newer because a run missed it.
  history      `closed` is a log and unions, keeping the earliest close. `open` and `watching` are
               snapshots of right now, so they come from the newer scrape.
"""


def merge_first_seen(ours, theirs):
    """Earliest wins, per key, in both sections. Missing sections are treated as empty."""
    out = {}
    for section in ("roles", "postings"):
        merged = dict(theirs.get(section) or {})
        for key, seen in (ours.get(section) or {}).items():
            current = merged.get(key)
            if current is None or seen < current:
                merged[key] = seen
        out[section] = merged
    return out


def merge_history(ours, theirs):
    """A union of the closed log, and the newer run's view of what is open."""
    closed = dict(theirs.get("closed") or {})
    for key, row in (ours.get("closed") or {}).items():
        current = closed.get(key)
        if current is None:
            closed[key] = row
            continue
        # Same role closed in both: keep the earlier close, and the earlier first sighting.
        keep = current if (current.get("closed_at") or "") <= (row.get("closed_at") or "") else row
        other = row if keep is current else current
        first = [f for f in (keep.get("first_seen"), other.get("first_seen")) if f]
        keep = dict(keep)
        if first:
            keep["first_seen"] = min(first)
        closed[key] = keep

    out = dict(theirs)
    out.update({k: v for k, v in ours.items() if k != "closed"})
    out["closed"] = closed
    return out
