/**
 * How old the board is, in the words a candidate cares about.
 *
 * The scraper runs several times a day, so the honest answer is almost always a number of hours.
 * Do not put a cadence in user-facing copy: the schedule asks for every 3 hours and GitHub Actions
 * actually delivers every 5.9 on average, worst 7.5 (measured over 16 runs, 22 to 25 Sep 2026).
 * This timestamp is the claim. It is computed, so it cannot drift away from the truth.
 * It stays honest when the run fails: the text says days and the dot stops reading as live, rather
 * than rounding a stale board down to "a few hours ago".
 */
export type Freshness = {
  text: string;
  live: boolean;
  hours: number;
};

export function freshness(generated: string | undefined, now = Date.now()): Freshness {
  if (!generated) return { text: "", live: false, hours: Infinity };
  // The engine writes "2026-09-19 08:22:17" in UTC with no zone marker.
  const t = Date.parse(generated.replace(" ", "T") + "Z");
  if (Number.isNaN(t)) return { text: "", live: false, hours: Infinity };
  const hours = Math.max(0, (now - t) / 3600000);

  if (hours < 1) return { text: "updated in the last hour", live: true, hours };
  if (hours < 24) {
    const n = Math.floor(hours);
    return { text: `updated ${n} hour${n === 1 ? "" : "s"} ago`, live: true, hours };
  }
  const days = Math.floor(hours / 24);
  return { text: `updated ${days} day${days === 1 ? "" : "s"} ago`, live: false, hours };
}
