import { useQuery } from "@tanstack/react-query";

export type Relevance = "core" | "related";

export type Role = {
  id: string;
  title: string;
  company: string;
  companySlug: string;
  locations: string[];
  country: string | null;
  remote: boolean;
  url: string;
  industries: string[];
  industrySource: string | null;
  companyIndustries: string[];
  relevance: Relevance;
  relevanceReason: string;
  flags: string[];
  /** The team or department the company's board lists it under. Absent before M12. */
  team?: string | null;
  firstSeen: string;
  isNew: boolean;
  /** The day the company's own board says it was published. Absent from files written before M11. */
  postedAt?: string | null;
  /** Days since posted, or since we first saw it when the board gave no date. */
  daysOpen?: number | null;
  /** Open 90 to 364 days. */
  longOpen?: boolean;
  /** Up a year or more: a standing pipeline listing, not a hard-to-fill role. */
  alwaysOpen?: boolean;
  /** The company's latest public round, copied on from the company when the file loads. */
  funding?: CompanyFunding | null;
};

/** Hiring intent from our own archive, core roles only (engine: scraper/signals.py). */
export type CompanySignals = {
  liveCore: number;
  openedLast30: number;
  /** Null until we have watched the company for 30 days: before that a closure count means nothing. */
  closedLast30: number | null;
  net30: number | null;
  watchedDays: number | null;
  oldestOpenDays: number | null;
  longOpen: number;
  alwaysOpen: number;
  /** Every core role open was posted in the last 60 days, and our archive holds no older one. */
  newToDeployment: boolean;
  closedCount: number;
  medianDaysToClose: number | null;
};

/** An investor as the announcement names it; `fund` is the tier-1 fund it is, if any. */
export type Backer = { name: string; tier1: boolean; fund?: string | null };

/**
 * A company's latest round, read from its public announcement (never from a licensed database), with the
 * link it came from. Tier 1 is a hand-picked list of funds.
 */
export type CompanyFunding = {
  round: string | null;
  amount: number | null;
  currency: string | null;
  announcedOn: string;
  daysAgo: number;
  leads: Backer[];
  investors: Backer[];
  tier1: boolean;
  sourceUrl: string;
};

export type Company = {
  slug: string;
  name: string;
  industries: string[];
  liveRoles: number;
  board: string | null;
  logo: string | null;
  signals?: CompanySignals | null;
  funding?: CompanyFunding | null;
  /** One named founder or chief executive, from a page the company published. */
  founder?: { name: string; title: string | null; sourceUrl: string } | null;
  /** On the board for what they will post, not what they have posted (docs/vision.md, the watchlist). */
  watching?: boolean;
  /** What the company has just announced, from its own feed. Headline, date and link only. */
  news?: { title: string; url: string; date: string | null }[];
};

export type Dataset = {
  generated: string;
  counts: Record<string, number>;
  industries: string[];
  roles: Role[];
  companies: Company[];
};

async function fetchDataset(): Promise<Dataset> {
  const res = await fetch("/data/roles.json");
  if (!res.ok) throw new Error("Could not load the roles file");
  const data = (await res.json()) as Dataset;
  // Every filter works on roles, so each role carries its company's latest round.
  const funding = new Map(data.companies.map((c) => [c.slug, c.funding ?? null]));
  for (const r of data.roles) r.funding = funding.get(r.companySlug) ?? null;
  return data;
}

export function useDataset() {
  return useQuery({
    queryKey: ["roles-dataset"],
    queryFn: fetchDataset,
    staleTime: Infinity,
  });
}

/** Companies present in the file plus any company that only appears on a role. */
export function allCompanies(data: Dataset): (Company & { roleCount: number })[] {
  const map = new Map<string, Company>();
  for (const c of data.companies) map.set(c.slug, c);
  for (const r of data.roles) {
    if (!map.has(r.companySlug)) {
      map.set(r.companySlug, {
        slug: r.companySlug,
        name: r.company,
        industries: r.companyIndustries ?? [],
        liveRoles: 0,
        board: null,
        logo: null,
        signals: null,
      });
    }
  }
  const counts = new Map<string, number>();
  for (const r of data.roles) counts.set(r.companySlug, (counts.get(r.companySlug) ?? 0) + 1);
  return [...map.values()]
    .map((c) => ({ ...c, roleCount: counts.get(c.slug) ?? 0 }))
    .sort((a, b) => b.roleCount - a.roleCount || a.name.localeCompare(b.name));
}

/** The industries worth naming to a reader: "horizontal" is our word for "none of them". */
export function realIndustries(industries: string[] | null | undefined) {
  return (industries ?? []).filter((i) => i !== "horizontal");
}

export function industryLabel(slug: string) {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function daysSince(stamp: string, now = Date.now()) {
  const t = Date.parse(stamp.replace(" ", "T") + "Z");
  if (Number.isNaN(t)) return Infinity;
  return (now - t) / 86400000;
}

/**
 * Posted in the last week. Uses the board's own publish date when there is one: our first-seen date
 * called 12 construction roles "new" on 19 Sep that had been up since as far back as March 2025, because
 * that was the day we started reading their boards.
 */
export function isFresh(role: Role, now = Date.now()) {
  if (role.daysOpen != null) return role.daysOpen <= 7;
  return daysSince(role.firstSeen, now) <= 7;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(day: string, now = new Date()) {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return y === now.getUTCFullYear() ? `${d} ${MONTHS[m - 1]}` : `${MONTHS[m - 1]} ${y}`;
}

/** One plain sentence on how long a role has been up, or null when we know nothing. */
export function postedLine(role: Role, now = new Date()): string | null {
  const days = role.daysOpen;
  if (days == null) return null;
  if (!role.postedAt) return `On the board ${days === 1 ? "1 day" : `${days} days`}.`;
  const when = shortDate(role.postedAt, now);
  if (role.alwaysOpen)
    return `Posted ${when}. Up for over a year, which usually means an always-open listing.`;
  if (days === 0) return "Posted today.";
  if (days === 1) return "Posted yesterday.";
  if (role.longOpen) return `Posted ${when}, open ${days} days and still unfilled.`;
  return `Posted ${when}, open ${days} days.`;
}

/** "lead" means the listing asks someone to run a team (the leadership flag); "ic" means it does not. */
export type Level = "" | "ic" | "lead";
/** Posted within this many days, or "" for any time. */
export type Posted = "" | "7" | "30";

export type Filters = {
  query: string;
  industries: string[];
  /** One geography control: "", "remote", "region:Europe" or "country:United Kingdom". */
  geo: string;
  level: Level;
  posted: Posted;
  /** Pre-seed, Seed, Series A, Series B, Series C+ (from the latest round's own name). */
  stages: string[];
  /** Tier-1 funds, by their canonical name: the company's latest round includes at least one. */
  backers: string[];
  /** Announced a round within this many days ("30", "90", "365"), or "" for any time. */
  raised: string;
  /** Only companies whose latest round includes a fund on the tier-1 list. */
  tier1: boolean;
};

export const emptyFilters: Filters = {
  query: "",
  industries: [],
  geo: "",
  level: "",
  posted: "",
  stages: [],
  backers: [],
  raised: "",
  tier1: false,
};

const SYMBOL: Record<string, string> = { USD: "$", GBP: "£", EUR: "€" };

/** "$95m", "£1.2m", "€600k", or null when the announcement gave no amount. */
export function money(amount: number | null, currency: string | null) {
  if (amount == null) return null;
  const sym = currency ? (SYMBOL[currency] ?? `${currency} `) : "";
  if (amount >= 1e9) return `${sym}${+(amount / 1e9).toFixed(1)}bn`;
  if (amount >= 1e6) return `${sym}${+(amount / 1e6).toFixed(amount < 1e7 ? 1 : 0)}m`;
  return `${sym}${Math.round(amount / 1e3)}k`;
}

/** "Series C, $95m, Jun 2026" from what the announcement stated. */
export function roundLine(f: CompanyFunding) {
  const [y, m] = f.announcedOn.split("-").map(Number);
  const when = `${MONTHS[(m ?? 1) - 1]} ${y}`;
  return [f.round ?? "Raised", money(f.amount, f.currency), when].filter(Boolean).join(", ");
}

/** Pre-seed, Seed, Series A, B, C and later, from the round's own name. */
export function stageOf(f: CompanyFunding | null | undefined): string | null {
  const r = (f?.round ?? "").toLowerCase();
  if (!r) return null;
  if (r.includes("pre-seed") || r.includes("pre seed")) return "Pre-seed";
  if (r.includes("seed")) return "Seed";
  const m = r.match(/series\s+([a-z])/);
  if (!m) return null;
  const letter = m[1]!.toUpperCase();
  return letter <= "B" ? `Series ${letter}` : "Series C+";
}

export function isLead(role: Role) {
  return (role.flags ?? []).includes("leadership");
}

/** Days since posted, falling back to days since we first saw it. */
export function ageOf(role: Role, now = Date.now()) {
  return role.daysOpen ?? Math.floor(daysSince(role.firstSeen, now));
}

/** "today", "5d", "3mo", "1y+": short enough for the right-hand column of a row. */
export function ageLabel(days: number) {
  if (!Number.isFinite(days)) return "";
  if (days <= 0) return "today";
  if (days < 60) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return "1y+";
}

/**
 * Where the work is. Candidates think in regions first and countries second, so the control offers
 * both. Anything the scrape has not placed in a country falls under "Not stated", which is honest:
 * 70 of 577 listings name a city the parser could not resolve, and hiding them would lose real roles.
 */
const REGION_OF: Record<string, string> = {
  "United States": "North America",
  Canada: "North America",
  Mexico: "North America",
  "United Kingdom": "Europe",
  Ireland: "Europe",
  France: "Europe",
  Germany: "Europe",
  Spain: "Europe",
  Portugal: "Europe",
  Italy: "Europe",
  Netherlands: "Europe",
  Belgium: "Europe",
  Switzerland: "Europe",
  Austria: "Europe",
  Sweden: "Europe",
  Norway: "Europe",
  Denmark: "Europe",
  Finland: "Europe",
  Poland: "Europe",
  Czechia: "Europe",
  Romania: "Europe",
  Greece: "Europe",
  Ukraine: "Europe",
  Japan: "Asia Pacific",
  Singapore: "Asia Pacific",
  India: "Asia Pacific",
  Australia: "Asia Pacific",
  "New Zealand": "Asia Pacific",
  "South Korea": "Asia Pacific",
  China: "Asia Pacific",
  "Hong Kong": "Asia Pacific",
  Taiwan: "Asia Pacific",
  Indonesia: "Asia Pacific",
  Malaysia: "Asia Pacific",
  Philippines: "Asia Pacific",
  Thailand: "Asia Pacific",
  Vietnam: "Asia Pacific",
  Israel: "Middle East and Africa",
  "United Arab Emirates": "Middle East and Africa",
  "Saudi Arabia": "Middle East and Africa",
  Qatar: "Middle East and Africa",
  "South Africa": "Middle East and Africa",
  Nigeria: "Middle East and Africa",
  Kenya: "Middle East and Africa",
  Egypt: "Middle East and Africa",
  Brazil: "Latin America",
  Argentina: "Latin America",
  Chile: "Latin America",
  Colombia: "Latin America",
  Peru: "Latin America",
  Uruguay: "Latin America",
};

const REGION_ORDER = [
  "North America",
  "Europe",
  "Asia Pacific",
  "Middle East and Africa",
  "Latin America",
  "Elsewhere",
];

export function regionOf(country: string | null | undefined) {
  if (!country) return null;
  return REGION_OF[country] ?? "Elsewhere";
}

export type GeoGroup = {
  region: string;
  count: number;
  countries: { name: string; count: number }[];
};

/** The geography control's options, built from what is actually on the board today. */
export function geographiesOf(roles: Role[]): {
  remote: number;
  unplaced: number;
  groups: GeoGroup[];
} {
  const byRegion = new Map<string, Map<string, number>>();
  let remote = 0;
  let unplaced = 0;
  for (const r of roles) {
    if (r.remote) remote += 1;
    if (!r.country) {
      unplaced += 1;
      continue;
    }
    const region = regionOf(r.country) as string;
    if (!byRegion.has(region)) byRegion.set(region, new Map());
    const inner = byRegion.get(region)!;
    inner.set(r.country, (inner.get(r.country) ?? 0) + 1);
  }
  const groups = [...byRegion.entries()]
    .map(([region, inner]) => ({
      region,
      count: [...inner.values()].reduce((a, b) => a + b, 0),
      countries: [...inner.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => REGION_ORDER.indexOf(a.region) - REGION_ORDER.indexOf(b.region));
  return { remote, unplaced, groups };
}

export function geoLabel(geo: string) {
  if (!geo) return "Anywhere";
  if (geo === "uk") return "UK, including remote";
  if (geo === "remote") return "Remote";
  if (geo === "unplaced") return "Not stated";
  return geo.slice(geo.indexOf(":") + 1);
}

export function matchesGeo(role: Role, geo: string) {
  if (!geo) return true;
  // "uk" is the one compound value: the United Kingdom plus remote roles a UK person can actually
  // take. A board's "remote" means remote inside its own country, and the data carries that country,
  // so a remote role stated as United States is not offered to a London reader. Counting loosely gave
  // 112; three of one week's six were US-remote, including an OpenAI role with NYC in its title.
  // Counting honestly gives 44 (21 Sep 2026), which is a shorter list of things that are real.
  if (geo === "uk")
    return (
      role.country === "United Kingdom" ||
      (Boolean(role.remote) && (!role.country || role.country === "United Kingdom"))
    );
  if (geo === "remote") return Boolean(role.remote);
  if (geo === "unplaced") return !role.country;
  if (geo.startsWith("region:")) return regionOf(role.country) === geo.slice(7);
  if (geo.startsWith("country:")) return role.country === geo.slice(8);
  return true;
}

/**
 * A company that sells into one or two industries lends them to all its roles. One that names more is a
 * platform: Palantir lists four, and inheriting them put its NATO and UK Government roles under healthcare.
 * Its roles then count only where their own title or listing names the industry.
 */
const MAX_INHERITED = 2;

export function industriesOf(role: Role): string[] {
  const own = realIndustries(role.industries);
  const company = realIndustries(role.companyIndustries);
  const lent = company.length <= MAX_INHERITED ? company.filter((i) => !own.includes(i)) : [];
  return [...own, ...lent];
}

export function roleIndustryMatch(role: Role, industry: string): "role" | "company" | null {
  if (realIndustries(role.industries).includes(industry)) return "role";
  if (industriesOf(role).includes(industry)) return "company";
  return null;
}

/**
 * The list shows core deployment roles only. Related roles (pre-sales and adjacent work) stay in the data
 * for company pages and employers, but a toggle that made the count jump by 250 read as noise.
 */
export function filterRoles(roles: Role[], f: Filters) {
  const q = f.query.trim().toLowerCase();
  const maxAge = f.posted ? Number(f.posted) : Infinity;
  return roles
    .filter((r) => {
      if (r.relevance !== "core") return false;
      if (q && !(r.title.toLowerCase().includes(q) || r.company.toLowerCase().includes(q)))
        return false;
      if (!matchesGeo(r, f.geo)) return false;
      if (f.level === "lead" && !isLead(r)) return false;
      if (f.level === "ic" && isLead(r)) return false;
      if (ageOf(r) > maxAge) return false;
      if (f.industries.length && !f.industries.some((i) => roleIndustryMatch(r, i))) return false;
      if (f.stages.length && !f.stages.includes(stageOf(r.funding) ?? "")) return false;
      if (
        f.backers.length &&
        !(r.funding?.investors ?? []).some((b) => f.backers.includes(b.fund ?? ""))
      )
        return false;
      if (f.raised && !(r.funding && r.funding.daysAgo <= Number(f.raised))) return false;
      if (f.tier1 && !r.funding?.tier1) return false;
      return true;
    })
    .sort((a, b) => ageOf(a) - ageOf(b) || a.company.localeCompare(b.company));
}

/** What a candidate told us in onboarding, as the board needs it. */
export type Space = {
  industries: string[];
  countries: string[];
  /** Count roles at platforms that sell to every industry as part of their space. */
  horizontal: boolean;
  level?: string | null;
};

/**
 * Is this role in the candidate's space? Industry first: their own industries, or a horizontal role
 * when they asked for those. Then geography: one of their countries, or remote. Level narrows it only
 * when they said they lead a team or that they do not.
 */
export function inSpace(role: Role, space: Space) {
  if (role.relevance !== "core") return false;
  const industries = industriesOf(role);
  const industryMatch = space.industries.length
    ? space.industries.some((i) => roleIndustryMatch(role, i))
    : true;
  const horizontalMatch = space.horizontal && industries.length === 0;
  if (!industryMatch && !horizontalMatch) return false;
  if (space.countries.length) {
    const here = role.country && space.countries.includes(role.country);
    if (!here && !role.remote) return false;
  }
  if (space.level === "lead" && !isLead(role)) return false;
  if (space.level === "ic" && isLead(role)) return false;
  return true;
}

export type ListItem =
  | { kind: "role"; role: Role }
  | { kind: "more"; companySlug: string; company: string; count: number };

export type AgeGroup = { label: string; count: number; items: ListItem[] };

const GROUPS: { label: string; upTo: number }[] = [
  { label: "This week", upTo: 7 },
  { label: "This month", upTo: 30 },
  { label: "Older", upTo: Infinity },
];

/**
 * Newest first, under This week / This month / Older, so the shape of the page says what is new. Inside
 * each group a company shows at most `cap` rows and then one "+ N more" line: Palantir and Databricks are
 * 103 of 331 core roles, and without the cap they bury everyone else.
 */
/** Newest funding first, for the "just raised" reading of the board. */
export function byRaised(a: Role, b: Role) {
  return (a.funding?.daysAgo ?? 99999) - (b.funding?.daysAgo ?? 99999) || ageOf(a) - ageOf(b);
}

export function groupRoles(roles: Role[], cap = 3): AgeGroup[] {
  const out: AgeGroup[] = [];
  let from = -Infinity;
  for (const g of GROUPS) {
    const inGroup = roles.filter((r) => {
      const age = ageOf(r);
      return age > from && age <= g.upTo;
    });
    from = g.upTo;
    if (!inGroup.length) continue;
    const seen = new Map<string, number>();
    const items: ListItem[] = [];
    const more = new Map<string, ListItem & { kind: "more" }>();
    for (const r of inGroup) {
      const n = (seen.get(r.companySlug) ?? 0) + 1;
      seen.set(r.companySlug, n);
      if (n <= cap) {
        items.push({ kind: "role", role: r });
      } else if (!more.has(r.companySlug)) {
        const line = {
          kind: "more" as const,
          companySlug: r.companySlug,
          company: r.company,
          count: 1,
        };
        more.set(r.companySlug, line);
        // The "more" line sits straight after that company's last shown row.
        const lastIdx = items
          .map((i) => i.kind === "role" && i.role.companySlug === r.companySlug)
          .lastIndexOf(true);
        items.splice(lastIdx + 1, 0, line);
      } else {
        more.get(r.companySlug)!.count += 1;
      }
    }
    out.push({ label: g.label, count: inGroup.length, items });
  }
  return out;
}

export function countriesOf(roles: Role[]) {
  return [...new Set(roles.map((r) => r.country).filter(Boolean) as string[])].sort();
}

/**
 * Companies that just raised and have not posted a deployment role yet.
 *
 * This is the "future role" in its most useful form: money landed, nobody hired, and we know who runs
 * the company. A company that raised and already has roles open is not here, because its roles are
 * already in the list below and a second row for it is noise (Databricks raised and has 50 open).
 *
 * These carry no geography. Seven of the twelve on 21 Sep 2026 have no role anywhere in our data, so
 * there is nothing to derive a country from, which is why they sit in their own band rather than being
 * interleaved into a list whose heading promises the United Kingdom.
 */
export function aboutToHire(data: Dataset, withinDays = 90): Company[] {
  return allCompanies(data)
    .filter((c) => (c.funding?.daysAgo ?? Infinity) <= withinDays && !c.liveRoles)
    .sort((a, b) => (a.funding?.daysAgo ?? 0) - (b.funding?.daysAgo ?? 0));
}
