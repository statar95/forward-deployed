"""Replay this run's data onto whatever is now on main, after a rejected push.

  python3 engine/reconcile.py /tmp/ours

Called only by .github/workflows/refresh-roles.yml when `git push` is rejected because another
refresh run pushed first. By then the working tree has been reset to origin/main, and `<dir>` holds
the copies this run generated. Each file is merged by what it means, in scraper.state_merge.

Rebasing instead was the bug: both runs regenerate the same derived files, so the rebase conflicted
every time, the retry pushed into a half-finished rebase, and the run failed.
"""
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scraper.state_merge import merge_first_seen, merge_history  # noqa: E402

ROLES = REPO / "public" / "data" / "roles.json"
FIRST_SEEN = ROOT / "first_seen.json"
HISTORY = ROOT / "history.json"


def load(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def write(path, doc):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=0 if path is FIRST_SEEN else 2, sort_keys=path is FIRST_SEEN))


def main(argv=None):
    argv = argv or sys.argv[1:]
    if not argv:
        print("usage: reconcile.py <dir holding this run's roles.json, first_seen.json, history.json>",
              file=sys.stderr)
        return 2
    ours_dir = Path(argv[0])

    # roles.json is a complete snapshot of one scrape. Mixing two is meaningless, so this run's wins.
    ours_roles = ours_dir / "roles.json"
    if ours_roles.exists():
        shutil.copyfile(ours_roles, ROLES)
        print(f"roles.json: took this run's scrape ({json.loads(ROLES.read_text())['counts']['roles']} roles)")

    ours_seen = load(ours_dir / "first_seen.json")
    if ours_seen is not None:
        merged = merge_first_seen(ours_seen, load(FIRST_SEEN) or {})
        write(FIRST_SEEN, merged)
        print(f"first_seen.json: merged to {len(merged['roles'])} roles, {len(merged['postings'])} postings")

    ours_history = load(ours_dir / "history.json")
    if ours_history is not None:
        merged = merge_history(ours_history, load(HISTORY) or {})
        write(HISTORY, merged)
        print(f"history.json: merged, {len(merged.get('closed') or {})} closed roles on the log")
    return 0


if __name__ == "__main__":
    sys.exit(main())
