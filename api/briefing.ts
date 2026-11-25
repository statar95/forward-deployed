/**
 * Build Monday's briefing and send it.
 *
 * **It sends.** There is no
 * review window, so everything that would have been caught by a person reading it first has to be
 * caught here instead.
 *
 * Three guards stand between the cron and someone's inbox:
 *
 * 1. **Freshness.** The dataset is fetched off the live site, so this inherits the deploy pipeline's
 *    health. On 5 Oct the site had been stale for four days and this drafted an issue claiming
 *    "12 new deployment roles this week" when the truth was 25. Anything older than
 *    MAX_DATA_AGE_HOURS does not send: it becomes a draft named so that it cannot be sent by
 *    accident, and a human decides.
 * 2. **Something to say.** A week with no new roles and no signals produces nothing at all, rather
 *    than an email whose subject is an apology.
 * 3. **Once only.** A cron that can fire twice and an endpoint that sends is how you mail everyone
 *    the same issue twice. Before creating anything this looks for a broadcast already named after
 *    today and stops if it finds one. Irreversible work keyed to an identity, not to a hope that the
 *    trigger only fires once.
 *
 * Guard 3 is what makes the second cron safe. `vercel.json` calls this twice every Monday, at 07:00
 * and 11:00, because one scheduled trigger is a single point of failure for the whole week: a cron
 * that silently does not fire means no issue until the following Monday, and nothing would say so.
 * The second call is a retry, not a second send. It finds the first call's broadcast and returns
 * `already_done`.
 *
 * One deliberate consequence: if the 07:00 run found stale data and left a `DO NOT SEND` draft, the
 * 11:00 retry finds that draft by name and also stops, even if the data has recovered by then. That
 * is the safer way round. A stale Monday becomes a draft for a human to look at rather than
 * something that quietly sends itself four hours later on data nobody checked.
 */
import { buildBriefing, type Dataset } from "../lib/briefing.js";
import { briefingSegmentId, enrolMissing } from "../lib/segment.js";
import { MANAGERS } from "../lib/hiring-managers.js";

const SITE = "https://forwarddeployed.work";
// The display name is quoted. Unquoted it arrived in the inbox as just "Forward", because a bare
// space ends the phrase and the rest is discarded.
const FROM = '"Forward Deployed" <briefing@send.forwarddeployed.work>';
const REPLY_TO = "hello@forwarddeployed.work";
const TOPIC_ID = "d44891af-e24e-4a11-ab33-78af23b431eb";
// How old the dataset may be before the issue stops being trustworthy. The scrape runs every couple
// of hours and this cron fires at 07:16 UTC, so a healthy Monday is well under an hour old.
const MAX_DATA_AGE_HOURS = 12;

type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
};
type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

export default async function handler(req: Req, res: Res) {
  const key = process.env["RESEND_API_KEY"];
  const secret = process.env["CRON_SECRET"];
  if (!key) {
    res.status(500).json({ error: "not_configured" });
    return;
  }

  // Vercel's scheduler sends the project's CRON_SECRET. Without this anyone could fill the
  // Resend account with drafts. Drafts are harmless, but noise in the Resend account is not.
  // Previously this read `if (secret && ...)`, so a project with no CRON_SECRET set had no auth at
  // all. That was tolerable while the worst case was an unwanted draft. It is not tolerable now
  // that a request to this path sends email to the whole list, so a missing secret is a refusal.
  const auth = req.headers["authorization"];
  if (!secret || auth !== `Bearer ${secret}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const data = (await fetch(`${SITE}/data/roles.json`, { cache: "no-store" }).then((r) =>
    r.ok ? r.json() : null,
  )) as Dataset | null;
  if (!data?.roles?.length) {
    res.status(502).json({ error: "no_dataset" });
    return;
  }

  // The dataset comes off the live site, so this handler inherits the deploy pipeline's health. On
  // 5 Oct 2026 Vercel had been refusing builds for four days, the site was serving 1 October data,
  // and this drafted an issue saying "12 new deployment roles this week" when the truth was 25. The
  // number looked entirely plausible, which is what made it dangerous. A stale dataset now says so
  // in the draft's name, where it cannot be missed.
  const generatedAt = Date.parse(`${data.generated.replace(" ", "T")}Z`);
  const ageHours = Number.isNaN(generatedAt)
    ? null
    : (Date.now() - generatedAt) / 3_600_000;
  const stale = ageHours === null || ageHours > MAX_DATA_AGE_HOURS;

  const briefing = buildBriefing(data, new Date(), 7, MANAGERS);
  // Funding has no automated intake: seeds/funding.csv only moves when the StrictlyVC import is run.
  // The email no longer prints a zero, so this log line is the only place a gap shows.
  const newestRound = Math.min(...data.companies.map((c) => c.funding?.daysAgo ?? 9999));
  if (newestRound > 10) console.warn(`briefing: newest funding round is ${newestRound} days old; run the StrictlyVC import`);
  if (!briefing.counts.roles && !briefing.counts.raised && !briefing.counts.building) {
    res.status(200).json({ status: "skipped", reason: "nothing_to_say" });
    return;
  }

  const segmentId = await briefingSegmentId(key);
  if (!segmentId) {
    res.status(502).json({ error: "no_segment" });
    return;
  }

  // Every subscriber has to be in the segment or the broadcast skips them. On 12, 19 and 26 Oct
  // nobody was, because sign-up never enrolled anyone, and Resend refused all three sends. This
  // catches up anyone missing, however they were added. If the lists cannot be read, carry on and
  // send to whoever is already in it rather than skip the week.
  const enrolled = await enrolMissing(key, segmentId);
  if (enrolled?.failed) console.error("briefing: could not enrol", enrolled.failed, "contacts");
  if (enrolled && enrolled.members === 0) {
    res.status(200).json({ status: "skipped", reason: "no_subscribers" });
    return;
  }

  const monday = new Date().toISOString().slice(0, 10);
  const name = stale
    ? `DO NOT SEND, ${ageHours === null ? "undated" : `${Math.round(ageHours)}h old`} data: Briefing ${monday}`
    : `Briefing ${monday}`;

  // Guard 3. Today's issue is identified by its date, so a second run finds the first run's work and
  // stops. Checked against the live list rather than anything this process remembers, because the
  // thing being prevented is a *second invocation*, which by definition remembers nothing.
  const existing = (await fetch("https://api.resend.com/broadcasts", {
    headers: { Authorization: `Bearer ${key}` },
  }).then((r) => (r.ok ? r.json() : null))) as
    | { data?: { id: string; name?: string; status?: string }[] }
    | null;
  if (!existing?.data) {
    // Not knowing whether today's issue already went out is not a reason to risk sending it twice.
    res.status(502).json({ error: "cannot_check_existing" });
    return;
  }
  const already = existing.data.find((b) => (b.name ?? "").includes(`Briefing ${monday}`));
  if (already) {
    res.status(200).json({
      status: "already_done",
      id: already.id,
      name: already.name,
      broadcastStatus: already.status,
    });
    return;
  }
  const made = await fetch("https://api.resend.com/broadcasts", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      segment_id: segmentId,
      topic_id: TOPIC_ID,
      from: FROM,
      reply_to: REPLY_TO,
      subject: briefing.subject,
      html: briefing.html,
      text: briefing.text,
      // Guard 1. Fresh data sends. Stale data omits `send`, which Resend treats as a draft, and the
      // name above already says not to send it.
      ...(stale ? {} : { send: true }),
    }),
  });

  if (!made.ok) {
    console.error("broadcast create failed", made.status, (await made.text()).slice(0, 500));
    res.status(502).json({ error: "upstream" });
    return;
  }

  const body = (await made.json()) as { id?: string };
  res.status(201).json({
    status: stale ? "drafted_stale_not_sent" : "sent",
    id: body.id,
    name,
    subject: briefing.subject,
    counts: briefing.counts,
    dataGenerated: data.generated,
    dataAgeHours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
    subscribers: enrolled?.members ?? null,
    enrolledNow: enrolled?.added ?? null,
  });
}
