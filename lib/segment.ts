/**
 * The Resend segment the Monday briefing is sent to, and keeping every subscriber in it.
 *
 * A broadcast must name a segment, and a contact is only in a segment if something put it there.
 * Until 26 Oct 2026 nothing did: `api/subscribe.ts` opted each contact into the briefing topic but
 * never added it to a segment, so "General" stayed empty and the briefing failed on 12, 19 and 26
 * Oct with "The audience you are sending has no contacts". Every sign-up in that time was real and
 * none of them received anything. Sign-up now enrols the contact, and the briefing enrols anyone
 * missing before it sends, so a contact added any other way (the dashboard, an import, a future
 * code path that forgets) is still reached.
 */

const API = "https://api.resend.com";

type Contact = { id: string; email: string; unsubscribed?: boolean };
type Page = { data?: Contact[]; has_more?: boolean };

/** "Audiences are now called Segments". Looked up rather than hardcoded so a rename in the dashboard
 *  does not silently stop the briefing. */
export async function briefingSegmentId(key: string): Promise<string | null> {
  const segments = (await fetch(`${API}/segments`, {
    headers: { Authorization: `Bearer ${key}` },
  }).then((r) => (r.ok ? r.json() : null))) as { data?: { id: string; name: string }[] } | null;
  const segment = segments?.data?.find((s) => s.name === "General") ?? segments?.data?.[0];
  return segment?.id ?? null;
}

async function listAll(key: string, segmentId?: string): Promise<Contact[] | null> {
  const out: Contact[] = [];
  let after: string | undefined;
  for (;;) {
    const q = new URLSearchParams({ limit: "100" });
    if (segmentId) q.set("segment_id", segmentId);
    if (after) q.set("after", after);
    const r = await fetch(`${API}/contacts?${q}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) {
      console.error("contacts list failed", r.status, (await r.text()).slice(0, 300));
      return null;
    }
    const page = (await r.json()) as Page;
    const data = page.data ?? [];
    out.push(...data);
    if (!page.has_more || !data.length) return out;
    after = data[data.length - 1]!.id;
  }
}

/** Put one contact in the segment. Safe to repeat. */
export async function enrol(key: string, contact: string, segmentId: string): Promise<boolean> {
  const r = await fetch(
    `${API}/contacts/${encodeURIComponent(contact)}/segments/${encodeURIComponent(segmentId)}`,
    { method: "POST", headers: { Authorization: `Bearer ${key}` } },
  );
  if (!r.ok) console.error("segment add failed", r.status, (await r.text()).slice(0, 300));
  return r.ok;
}

/** Enrol every subscribed contact that is not in the segment yet. Null when the lists cannot be
 *  read, which the caller treats as "do not know who would receive this". */
export async function enrolMissing(
  key: string,
  segmentId: string,
): Promise<{ added: number; failed: number; members: number } | null> {
  const [everyone, members] = await Promise.all([listAll(key), listAll(key, segmentId)]);
  if (!everyone || !members) return null;
  const inside = new Set(members.map((c) => c.id));
  let added = 0;
  let failed = 0;
  for (const c of everyone) {
    if (c.unsubscribed || inside.has(c.id)) continue;
    // One at a time, because Resend rate limits per second and a Monday run is not in a hurry.
    if (await enrol(key, c.id, segmentId)) added += 1;
    else failed += 1;
    await new Promise((r) => setTimeout(r, 250));
  }
  return { added, failed, members: members.length + added };
}
