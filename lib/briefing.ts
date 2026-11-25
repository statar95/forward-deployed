/**
 * The Monday briefing: what changed on the board this week.
 *
 * One email for everyone, not one per industry. Measured 21 Sep 2026: 15 roles were posted in the
 * last seven days and the biggest single industry among them had two. An industry-only email would
 * arrive with one role in it, which is worse than no email. So the roles are grouped by industry with
 * the biggest group first, and the reader finds their own line in four seconds. The industry answer
 * still earns its place: it tells us where to go looking for supply, and it becomes real segmentation
 * when a week has enough in it.
 *
 * Everything here comes from the same roles.json the site renders, so the email can never claim a role
 * the board does not show.
 */
import type { Manager } from "./hiring-managers.js";

export type Role = {
  id: string;
  title: string;
  company: string;
  companySlug: string;
  url: string;
  relevance: string;
  postedAt?: string | null;
  daysOpen?: number | null;
  country?: string | null;
  remote?: boolean;
  locations?: string[];
  team?: string | null;
  industries?: string[];
  companyIndustries?: string[];
};

export type Company = {
  slug: string;
  name: string;
  industries?: string[];
  signals?: { newToDeployment?: boolean; liveCore?: number; oldestOpenDays?: number } | null;
  funding?: {
    round?: string | null;
    amount?: number | null;
    currency?: string | null;
    daysAgo?: number;
    leads?: string[];
    tier1?: boolean;
    sourceUrl?: string | null;
  } | null;
  /** The founder, from the company's own page (seeds/founders.csv). Public, so it is on the site too. */
  founder?: { name: string; title?: string | null; sourceUrl?: string | null } | null;
  /** One line on what the company does, in its own words. See scraper/pitch.py. */
  pitch?: string | null;
  /** How much an FDE should care about this company. See scraper/fde_likely.py for how it is scored. */
  fdeLikely?: { score: number | null; scored: boolean; reasons: string[] } | null;
  /**
   * What the company has just announced, from its own feed, newest first. Headline, date and link
   * only, never the body. See scraper/news.py for why, and scripts/fetch_news.py for where it comes
   * from. The exporter has been attaching this since 30 Sep 2026 and the briefing has been reading
   * it, but it was never declared here, so `tsc -p tsconfig.api.json` failed on every run and the
   * news line had no type safety at all.
   */
  news?: { title: string; url: string; date: string | null }[] | null;
};

export type Dataset = { generated: string; roles: Role[]; companies: Company[] };

export type Briefing = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  counts: { roles: number; raised: number; building: number };
};

const SITE = "https://forwarddeployed.work";
const MARK = `${SITE}/apple-touch-icon.png`;
// Instrument Serif to match the landing page. Apple Mail fetches it, Gmail strips the stylesheet and
// falls back to Georgia, which is the nearest serif already on the machine.
const DISPLAY = "'Instrument Serif', Georgia, 'Times New Roman', serif";
const INK = "#13161a";
const MUTED = "#65696f";
const HAIRLINE = "#ecebe8";
const PAPER = "#fbfaf8";

const LABELS: Record<string, string> = {
  "life-sciences": "Life sciences",
  "real-estate": "Real estate",
  // Not "Other": these are the companies that sell the same product into every industry, which is a
  // fact about them, not a gap in our tagging.
  other: "Across industries",
};

export function industryLabel(slug: string) {
  return LABELS[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " ");
}

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ageDays(role: Role, today: Date) {
  if (!role.postedAt) return role.daysOpen ?? null;
  const posted = Date.parse(role.postedAt.slice(0, 10));
  if (Number.isNaN(posted)) return role.daysOpen ?? null;
  return Math.floor((today.getTime() - posted) / 86_400_000);
}

/**
 * Where a role sits, in the shortest form that is still true.
 *
 * Boards hand back one string holding every city a role is open in, pipe separated, for example
 * "Remote-Friendly (Travel-Required) | San Francisco, CA | Seattle, WA | New York City, NY". Printed
 * whole it wraps to three lines and buries the role. The first city plus a count says the same thing.
 */
function place(role: Role) {
  if (role.remote) return "Remote";
  const raw = role.locations?.length ? role.locations.join(" | ") : (role.country ?? "");
  const parts = raw
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return "";
  const first = parts[0]!;
  const head = first.length > 42 ? `${first.slice(0, 40).trimEnd()}…` : first;
  return parts.length > 1 ? `${head} and ${parts.length - 1} more` : head;
}

function industriesOf(role: Role) {
  const own = (role.industries ?? []).filter((i) => i !== "horizontal");
  if (own.length) return own;
  return (role.companyIndustries ?? []).filter((i) => i !== "horizontal");
}

function money(amount?: number | null, currency?: string | null) {
  if (!amount) return null;
  const sign = currency === "GBP" ? "£" : currency === "EUR" ? "€" : "$";
  if (amount >= 1_000_000_000) return `${sign}${(amount / 1_000_000_000).toFixed(1)}b`;
  if (amount >= 1_000_000) return `${sign}${Math.round(amount / 1_000_000)}m`;
  return `${sign}${Math.round(amount / 1000)}k`;
}

/**
 * @param days how far back "new" reaches. Seven on a Monday, so the week is covered exactly once.
 */
/**
 * `managers` is who runs deployment at each company. Only briefing subscribers see them, never the
 * public site, so they come in here from lib/hiring-managers.ts and nowhere in src/ imports that.
 */
export function buildBriefing(
  data: Dataset,
  today = new Date(),
  days = 7,
  managers: Record<string, Manager> = {},
): Briefing {
  const core = data.roles.filter((r) => r.relevance === "core");
  const fresh = core
    .filter((r) => {
      const age = ageDays(r, today);
      return age !== null && age <= days;
    })
    .sort((a, b) => (ageDays(a, today) ?? 0) - (ageDays(b, today) ?? 0));

  // The United Kingdom and remote come first, then everywhere else, because the people we are
  // going out to are in London and a list that opens in San Francisco is not their list. Nothing is
  // dropped: the rest follows under its own heading, so somebody who moved still sees the market.
  // "Remote" on a job board means remote inside that board's country, and the data says which, so a
  // role stated as remote in the United States is not offered to a London reader as if it were theirs.
  const isNear = (r: Role) =>
    r.country === "United Kingdom" ||
    (Boolean(r.remote) && (!r.country || r.country === "United Kingdom"));
  const near = fresh.filter(isNear);
  const far = fresh.filter((r) => !isNear(r));

  const groupBy = (rows: Role[]) => {
    const groups = new Map<string, Role[]>();
    for (const r of rows) {
      const list = industriesOf(r);
      const key = list.length ? list[0]! : "other";
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
    }
    return groups;
  };
  const groups = groupBy(near);
  // Biggest group first, except "other", which always goes last however big it is. It was the
  // largest group on 21 Sep (9 of 15) and led the email, so the first thing a reader saw was the
  // bucket that says nothing about them. These are the horizontal sellers, so they are labelled
  // honestly rather than hidden.
  const rank = (entries: [string, Role[]][]) =>
    entries.sort((a, b) => {
      if (a[0] === "other") return 1;
      if (b[0] === "other") return -1;
      return b[1].length - a[1].length || a[0].localeCompare(b[0]);
    });
  const ordered = rank([...groups.entries()]);
  const elsewhere = far;

  const bySlug = new Map(data.companies.map((c) => [c.slug, c]));
  // Ranked by whether the company needs people on the ground, not by how much it raised. A self-serve
  // tool raising $50m is news to nobody who deploys software inside a customer; a vertical AI company
  // selling into hospitals raising $8m is the whole point. Recency breaks a tie.
  // A company we could not judge keeps its place by date rather than being sunk to the bottom:
  // scoring silence as a negative cut Helsing and Hadrian on the first run of this.
  const careAbout = (c: Company) => (c.fdeLikely?.scored ? (c.fdeLikely.score ?? 0) : 4);
  const raised = data.companies
    .filter((c) => (c.funding?.daysAgo ?? 999) <= 30)
    .sort(
      (a, b) =>
        careAbout(b) - careAbout(a) || (a.funding?.daysAgo ?? 0) - (b.funding?.daysAgo ?? 0),
    );
  const building = data.companies
    .filter((c) => c.signals?.newToDeployment)
    .sort((a, b) => (a.signals?.oldestOpenDays ?? 0) - (b.signals?.oldestOpenDays ?? 0))
    .slice(0, 8);

  const subject = near.length
    ? `${near.length} new deployment ${near.length === 1 ? "role" : "roles"} you can take from London`
    : fresh.length
      ? `${fresh.length} new deployment ${fresh.length === 1 ? "role" : "roles"} this week`
      : "No new deployment roles this week";
  // Only say what there is. "Plus 0 companies that just raised" went out on 9 and 16 Nov 2026 because
  // funding intake had stopped, and a zero printed as news reads as "nobody raised", which is false.
  const extras = [
    raised.length ? `${raised.length} ${raised.length === 1 ? "company" : "companies"} that just raised` : null,
    building.length ? `${building.length} building a deployment team now` : null,
  ].filter(Boolean);
  const preheader = fresh.length
    ? extras.length ? `Plus ${extras.join(", and ")}.` : "Every role below was posted in the last seven days."
    : `Nothing new was posted, so here is who is about to hire instead.`;

  return {
    subject,
    preheader,
    counts: { roles: fresh.length, raised: raised.length, building: building.length },
    html: renderHtml({ ordered, elsewhere, raised, building, bySlug, today, preheader, managers }),
    text: renderText({ ordered, elsewhere, raised, building, today, preheader, managers }),
  };
}

type Parts = {
  ordered: [string, Role[]][];
  elsewhere: Role[];
  raised: Company[];
  building: Company[];
  bySlug?: Map<string, Company>;
  today: Date;
  preheader: string;
  managers: Record<string, Manager>;
};

/** The hiring manager under a company's first role in this issue, and not again: one company often has
 *  several roles listed back to back, and the same name three times reads as filler. */
function managerOnce(managers: Record<string, Manager>) {
  const seen = new Set<string>();
  return (role: Role | string): Manager | null => {
    const slug = typeof role === "string" ? role : role.companySlug;
    const m = managers[slug];
    if (!m || seen.has(slug)) return null;
    seen.add(slug);
    return m;
  };
}

/** Who a candidate should write to at a company that just raised. The person running deployment when we
 *  have one; otherwise the founder, who at seed and Series A is the one hiring the first FDEs. */
function contactFor(c: Company, who: (s: string) => Manager | null) {
  const m = who(c.slug);
  if (m) return { label: "Runs deployment", name: m.name, detail: m.headline, url: m.url };
  if (c.founder?.name)
    return { label: "Write to", name: c.founder.name, detail: c.founder.title || "Founder", url: null as string | null };
  return null;
}

function roleLine(role: Role, today: Date) {
  const where = place(role);
  const age = ageDays(role, today);
  const when = age === 0 ? "today" : age === 1 ? "yesterday" : `${age} days ago`;
  return { where, when };
}

function renderHtml({ ordered, elsewhere, raised, building, today, preheader, managers }: Parts) {
  const who = managerOnce(managers);
  const whoHtml = (r: Role) => {
    const m = who(r);
    return m
      ? `<div style="font:400 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${MUTED};padding-top:2px">Runs deployment: <a href="${esc(m.url)}" style="color:${INK}">${esc(m.name)}</a>, ${esc(m.headline)}</div>`
      : "";
  };
  const head = `<tr><td style="padding:0 0 26px 0">
    <a href="${SITE}" style="text-decoration:none;color:${INK}">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:10px;vertical-align:middle">
          <img src="${MARK}" width="26" height="26" alt="" style="display:block;width:26px;height:26px;border:0;border-radius:50%">
        </td>
        <td style="vertical-align:middle">
          <span style="font:400 22px/1 ${DISPLAY};letter-spacing:-0.01em;color:${INK}">Forward Deployed</span>
        </td>
      </tr></table>
    </a>
    <div style="font:400 32px/1.15 ${DISPLAY};color:${INK};padding-top:20px">Who got the money, and who they will need.</div>
    <div style="font:400 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${MUTED};padding-top:10px;max-width:46em">${esc(preheader)}</div>
  </td></tr>`;

  // Funding leads. It is the section that is worth reading when you are happy where you are, and
  // the one an FDE cannot get anywhere else. Roles follow, because a list of jobs is only interesting
  // to the minority who are actively looking.
  const sections: string[] = [];

  if (raised.length) {
    const rows = raised
      .map((c) => {
        const f = c.funding!;
        const amount = money(f.amount, f.currency);
        const bits = [f.round, amount, f.daysAgo != null ? `${f.daysAgo} days ago` : null]
          .filter(Boolean)
          .join(", ");
        const hiring = c.signals?.liveCore
          ? `hiring ${c.signals.liveCore} deployment ${c.signals.liveCore === 1 ? "role" : "roles"}`
          : "no deployment role yet";
        // Their own latest announcement, where we have one. This is the line a candidate opens a
        // conversation with, so it earns its place next to the money.
        const does = c.pitch
          ? `<div style="font:400 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK};padding-top:5px">${esc(c.pitch)}</div>`
          : "";
        const p = contactFor(c, who);
        const person = p
          ? `<div style="font:400 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${MUTED};padding-top:4px">${p.label}: ${p.url ? `<a href="${esc(p.url)}" style="color:${INK}">${esc(p.name)}</a>` : `<span style="color:${INK}">${esc(p.name)}</span>`}, ${esc(p.detail)}</div>`
          : "";
        const item = c.news?.[0];
        const said = item
          ? `<div style="font:400 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${MUTED};padding-top:4px">Just announced: <a href="${esc(item.url)}" style="color:${INK}">${esc(item.title)}</a></div>`
          : "";
        return `<tr><td style="padding:13px 0;border-bottom:1px solid ${HAIRLINE}">
          <a href="${SITE}/companies/${esc(c.slug)}" style="font:400 17px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK};text-decoration:none">${esc(c.name)}</a>
          <div style="font:400 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${MUTED};padding-top:3px">${esc(bits)} &middot; ${esc(hiring)}</div>
          ${does}${person}${said}
        </td></tr>`;
      })
      .join("");
    sections.push(
      sectionHtml("Just raised", String(raised.length), rows,
        "Biggest cheque does not mean most hiring, so these run in the order an FDE should care about."),
    );
  }

  for (const [industry, roles] of ordered) {
    const rows = roles
      .map((r) => {
        const { where, when } = roleLine(r, today);
        const meta = [where, when].filter(Boolean).join(" · ");
        return `<tr><td style="padding:13px 0;border-bottom:1px solid ${HAIRLINE}">
          <a href="${esc(r.url)}" style="font:400 17px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK};text-decoration:none">${esc(r.title)}</a>
          <span style="font:400 14px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${MUTED}">&nbsp;&nbsp;${esc(r.company)}</span>
          <div style="font:400 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${MUTED};padding-top:3px">${esc(meta)}</div>${whoHtml(r)}
        </td></tr>`;
      })
      .join("");
    sections.push(sectionHtml(industryLabel(industry), String(roles.length), rows));
  }

  if (elsewhere.length) {
    // Capped. Databricks alone contributed seven near-identical "Sr. Deployment Strategist" lines
    // this week, and a briefing that scrolls for a minute is one nobody finishes. The rest are on
    // the board, one click away, and the count says exactly how many are not shown.
    const ELSEWHERE_CAP = 8;
    const shown = elsewhere.slice(0, ELSEWHERE_CAP);
    const hidden = elsewhere.length - shown.length;
    const rows = shown
      .map((r) => {
        const { where, when } = roleLine(r, today);
        const meta = [where, when].filter(Boolean).join(" · ");
        return `<tr><td style="padding:13px 0;border-bottom:1px solid ${HAIRLINE}">
          <a href="${esc(r.url)}" style="font:400 16px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK};text-decoration:none">${esc(r.title)}</a>
          <span style="font:400 14px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${MUTED}">&nbsp;&nbsp;${esc(r.company)}</span>
          <div style="font:400 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${MUTED};padding-top:3px">${esc(meta)}</div>${whoHtml(r)}
        </td></tr>`;
      })
      .join("");
    const more = hidden
      ? `<tr><td style="padding:13px 0"><a href="${SITE}/roles" style="font:400 14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK}">and ${hidden} more on the board</a></td></tr>`
      : "";
    sections.push(sectionHtml("Elsewhere", String(elsewhere.length), rows + more));
  }

  if (building.length) {
    const rows = building
      .map(
        (c) => `<tr><td style="padding:13px 0;border-bottom:1px solid ${HAIRLINE}">
        <a href="${SITE}/companies/${esc(c.slug)}" style="font:400 16px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK};text-decoration:none">${esc(c.name)}</a>
        <div style="font:400 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${MUTED};padding-top:3px">${c.signals?.liveCore ?? 0} open, the first one ${c.signals?.oldestOpenDays ?? 0} days ago</div>
      </td></tr>`,
      )
      .join("");
    sections.push(
      sectionHtml(
        "Building a deployment team now",
        String(building.length),
        rows,
        "Every deployment role open at these is less than 60 days old, so the team is being built right now.",
      ),
    );
  }

  const foot = `<tr><td style="padding:34px 0 0 0;border-top:1px solid ${HAIRLINE}">
    <div style="font:400 13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${MUTED};max-width:44em">
      Read several times a day from each company's own job board. Every role above links straight to the company's page, never to an aggregator.
      <br><br>
      <a href="${SITE}/roles" style="color:${INK}">See every live role</a> &nbsp;&middot;&nbsp;
      <a href="${SITE}/future" style="color:${INK}">Who is about to hire</a> &nbsp;&middot;&nbsp;
      <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:${MUTED}">Unsubscribe</a>
      <br><br>
      You are getting this because you asked for it on forwarddeployed.work. Reply and a person reads it.
    </div>
  </td></tr>`;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(preheader)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif&display=swap"></head>
<body style="margin:0;padding:0;background:${PAPER}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}">
<tr><td align="center" style="padding:34px 20px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
${head}${sections.join("")}${foot}
</table></td></tr></table></body></html>`;
}

function sectionHtml(head: string, count: string, rows: string, note?: string) {
  return `<tr><td style="padding:22px 0 0 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="border-bottom:1px solid ${INK};padding-bottom:6px">
        <span style="font:500 12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:${INK}">${esc(head)}</span>
        <span style="float:right;font:400 12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${MUTED}">${esc(count)}</span>
      </td></tr>
      ${note ? `<tr><td style="padding:10px 0 0 0;font:400 13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${MUTED}">${esc(note)}</td></tr>` : ""}
      <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
    </table>
  </td></tr>`;
}

function renderText({ ordered, elsewhere, raised, building, today, preheader, managers }: Parts) {
  const who = managerOnce(managers);
  const out: string[] = ["FORWARD DEPLOYED", "Who got the money, and who they will need.", "", preheader, ""];
  // Same order as the HTML. The two used to disagree: the HTML led with funding and its plain text
  // twin still led with roles, so a reader on a text-only client saw a different email.
  if (raised.length) {
    out.push(`JUST RAISED (${raised.length})`);
    out.push("  Biggest cheque does not mean most hiring, so these run in the order an FDE should care about.");
    for (const c of raised) {
      const f = c.funding!;
      const bits = [f.round, money(f.amount, f.currency), `${f.daysAgo} days ago`]
        .filter(Boolean)
        .join(", ");
      const hiring = c.signals?.liveCore
        ? `hiring ${c.signals.liveCore} deployment ${c.signals.liveCore === 1 ? "role" : "roles"}`
        : "no deployment role yet";
      out.push(`  ${c.name} -- ${bits} . ${hiring}`);
      if (c.pitch) out.push(`  ${c.pitch}`);
      const p = contactFor(c, who);
      if (p) out.push(`  ${p.label}: ${p.name}, ${p.detail}${p.url ? ` ${p.url}` : ""}`);
      const item = c.news?.[0];
      if (item) out.push(`  Just announced: ${item.title}`);
      out.push(`  ${SITE}/companies/${c.slug}`);
    }
    out.push("");
  }
  for (const [industry, roles] of ordered) {
    out.push(`${industryLabel(industry).toUpperCase()} (${roles.length})`);
    for (const r of roles) {
      const { where, when } = roleLine(r, today);
      out.push(`  ${r.title} -- ${r.company}`);
      out.push(`  ${[where, when].filter(Boolean).join(" . ")}`);
      out.push(`  ${r.url}`);
      const m = who(r);
      if (m) out.push(`  Runs deployment: ${m.name}, ${m.headline} ${m.url}`);
      out.push("");
    }
  }
  if (elsewhere.length) {
    out.push(`ELSEWHERE (${elsewhere.length})`);
    for (const r of elsewhere.slice(0, 8)) {
      const { where, when } = roleLine(r, today);
      out.push(`  ${r.title} -- ${r.company}`);
      out.push(`  ${[where, when].filter(Boolean).join(" . ")}`);
      out.push(`  ${r.url}`);
      const m = who(r);
      if (m) out.push(`  Runs deployment: ${m.name}, ${m.headline} ${m.url}`);
      out.push("");
    }
    if (elsewhere.length > 8) out.push(`  and ${elsewhere.length - 8} more: ${SITE}/roles`);
    out.push("");
  }
  if (building.length) {
    out.push(`BUILDING A DEPLOYMENT TEAM NOW (${building.length})`);
    for (const c of building) {
      out.push(
        `  ${c.name} -- ${c.signals?.liveCore ?? 0} open, the first one ${c.signals?.oldestOpenDays ?? 0} days ago`,
      );
    }
    out.push("");
  }
  out.push("---");
  out.push(`Every live role: ${SITE}/roles`);
  out.push(`Who is about to hire: ${SITE}/future`);
  out.push("Unsubscribe: {{{RESEND_UNSUBSCRIBE_URL}}}");
  out.push("You are getting this because you asked for it on forwarddeployed.work.");
  return out.join("\n");
}
