import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { SiteFrame } from "@/components/SiteFrame";
import { RoleRow } from "@/components/RoleRow";
import { LivePulse } from "@/components/LivePulse";
import { FilterMenu, type MenuOption } from "@/components/FilterMenu";
import { BriefingSignup } from "@/components/BriefingSignup";
import {
  emptyFilters,
  filterRoles,
  geoLabel,
  geographiesOf,
  groupRoles,
  industriesOf,
    industryLabel,
  isLead,
  matchesGeo,
  byRaised,
  roleIndustryMatch,
  stageOf,
  useDataset,
  type Filters,
  type Level,
  type Posted,
} from "@/lib/roles";

type Search = {
  industry?: string | undefined;
  geo?: string | undefined;
  q?: string | undefined;
  level?: string | undefined;
  stage?: string | undefined;
  tier1?: boolean | undefined;
  /** "posted" (default) or "raised": newest funding first. */
  sort?: string | undefined;
};

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export const Route = createFileRoute("/")({
  // Every filter lives in the address bar, so /?industry=construction&geo=country:United+Kingdom is a
  // real link someone can send to a candidate. Industry takes a comma-separated list.
  //
  // This is the front page as of 6 Oct 2026. It used to be at /roles behind a landing page that
  // opened with an email capture and put the board behind a secondary link reading "Or browse the
  // board". That asked for an address before showing the only thing of value, which is what the one
  // FDE who looked at it reacted to when he said he would not sign up. /roles still redirects here,
  // because briefings already sent link to it.
  validateSearch: (search: Record<string, unknown>): Search => ({
    industry: str(search["industry"]),
    geo: str(search["geo"]),
    q: str(search["q"]),
    level: str(search["level"]),
    stage: str(search["stage"]),
    tier1: search["tier1"] === true || search["tier1"] === "true" ? true : undefined,
    sort: search["sort"] === "raised" ? "raised" : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Every live forward deployed role" },
      {
        name: "description",
        content:
          "Forward deployed, deployment and delivery roles read straight from company job boards several times a day, newest first, filtered by the industry you already know.",
      },
    ],
  }),
  component: RolesPage,
});

const STAGES = ["Pre-seed", "Seed", "Series A", "Series B", "Series C+"];

const LEVELS: MenuOption[] = [
  { value: "ic", label: "Individual" },
  { value: "lead", label: "Lead a team" },
];

/**
 * The default is "uk", not "anywhere": the people we are going out to are in London, and a board
 * that opens on 208 United States roles is someone else's board to them. It is one click to clear,
 * and the list says so in words above the results rather than hiding it inside a filter chip.
 * `?geo=` in the address bar means anywhere, so a shared link can still say "everywhere" explicitly.
 */
function fromSearch(s: Search): Filters {
  return {
    ...emptyFilters,
    industries: s.industry ? s.industry.split(",").filter(Boolean) : [],
    geo: s.geo === undefined ? "uk" : s.geo,
    query: s.q ?? "",
    level: s.level === "ic" || s.level === "lead" ? s.level : "",
    posted: "",
    stages: s.stage ? s.stage.split(",").filter(Boolean) : [],
    backers: [],
    raised: "",
    tier1: Boolean(s.tier1),
  };
}

function RolesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data, isPending, isError } = useDataset();
  const [filters, setFilters] = useState<Filters>(() => fromSearch(search));
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  useEffect(() => {
    void navigate({
      search: {
        industry: filters.industries.join(",") || undefined,
        geo: filters.geo || undefined,
        q: filters.query.trim() || undefined,
        level: filters.level || undefined,
        stage: filters.stages.join(",") || undefined,
        tier1: filters.tier1 || undefined,
        sort: sort === "raised" ? "raised" : undefined,
      },
      replace: true,
    });
  }, [filters, navigate]);

  const roles = useMemo(() => data?.roles ?? [], [data]);
  const core = useMemo(() => roles.filter((r) => r.relevance === "core"), [roles]);
  const [sort, setSort] = useState<"posted" | "raised">(
    search.sort === "raised" ? "raised" : "posted",
  );
  const results = useMemo(() => filterRoles(roles, filters), [roles, filters]);
  const groups = useMemo(() => groupRoles(results), [results]);
  // "Just raised" is a different question from "just posted", so it gets its own flat list.
  const byFunding = useMemo(() => [...results].sort(byRaised), [results]);

  // Each menu counts against the other filters, so a number in a menu is what you get by picking it.
  const without = (patch: Partial<Filters>) => filterRoles(roles, { ...filters, ...patch });

  const industryOptions = useMemo<MenuOption[]>(() => {
    const base = filterRoles(roles, { ...filters, industries: [] });
    const counts = new Map<string, number>();
    for (const r of base) for (const i of industriesOf(r)) counts.set(i, (counts.get(i) ?? 0) + 1);
    const all = new Set((data?.industries ?? []).filter((i) => i !== "horizontal"));
    for (const i of filters.industries) all.add(i);
    return [...all]
      .map((i) => ({ value: i, label: industryLabel(i), count: counts.get(i) ?? 0 }))
      .filter((o) => o.count > 0 || filters.industries.includes(o.value))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles, data, filters.geo, filters.level, filters.query, filters.industries]);

  const geoOptions = useMemo<MenuOption[]>(() => {
    const g = geographiesOf(without({ geo: "" }));
    const out: MenuOption[] = [];
    const base = without({ geo: "" });
    const ukOrRemote = base.filter((r) => matchesGeo(r, "uk")).length;
    if (ukOrRemote) out.push({ value: "uk", label: "UK, including remote", count: ukOrRemote });
    if (g.remote) out.push({ value: "remote", label: "Remote", count: g.remote });
    for (const group of g.groups) {
      out.push({
        value: `region:${group.region}`,
        label: group.region,
        count: group.count,
        heading: true,
      });
      for (const c of group.countries)
        out.push({ value: `country:${c.name}`, label: c.name, count: c.count });
    }
    if (g.unplaced) out.push({ value: "unplaced", label: "Country not stated", count: g.unplaced });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles, filters.industries, filters.level, filters.query]);

  const levelOptions = LEVELS.map((o) => ({
    ...o,
    count: without({ level: "" }).filter((r) => (o.value === "lead" ? isLead(r) : !isLead(r)))
      .length,
  }));
  const tier1Count = without({ tier1: true }).length;

  // Stage lists only what the board has, counted against the other filters.
  const stageOptions: MenuOption[] = STAGES.map((st) => ({
    value: st,
    label: st,
    count: without({ stages: [] }).filter((r) => stageOf(r.funding) === st).length,
  })).filter((o) => o.count > 0 || filters.stages.includes(o.value));
  const companies = new Set(core.map((r) => r.companySlug)).size;
  // Everything except geo. The "before the job exists" rows have no country, so the geo filter has
  // nothing to say about them, but a real narrowing (industry, level, stage, search) should hide them.
  const narrowed = Boolean(
    filters.industries.length ||
      filters.query.trim() ||
      filters.level ||
      filters.stages.length ||
      filters.tier1,
  );
  const anyFilter =
    filters.industries.length ||
    filters.geo ||
    filters.query.trim() ||
    filters.level ||
    filters.stages.length ||
    filters.tier1;
  const single = filters.industries.length === 1 ? filters.industries[0] : null;

  return (
    <SiteFrame>
      <div className="mx-auto max-w-[1180px] px-6 sm:px-10">
        <div className="mt-12 flex flex-wrap items-baseline justify-between gap-4 sm:mt-16">
          <h1 className="font-display max-w-[22ch] text-[34px] leading-[1.05] tracking-[-0.02em] sm:text-[48px]">
            {single ? `${industryLabel(single)} deployment roles` : "Every role on the ground"}
          </h1>
          <LivePulse generated={data?.generated} />
        </div>
        <p className="mt-4 max-w-[60ch] text-[16px] leading-relaxed text-muted-foreground">
          {core.length
            ? `${core.length} deployment roles at ${companies} companies, read from their own boards. Newest first.`
            : " "}
          {core.length && filters.geo === "uk" ? (
            <>
              {" "}
              Showing the United Kingdom, including remote roles open to it.{" "}
              <button
                type="button"
                onClick={() => set({ geo: "" })}
                className="border-b border-foreground/40 text-foreground hover:border-foreground"
              >
                See everywhere
              </button>
              .
            </>
          ) : null}
        </p>

        <div className="sticky top-[57px] z-20 -mx-6 mt-8 border-b border-hairline bg-background/95 px-6 backdrop-blur-sm sm:-mx-10 sm:px-10">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 py-3">
            <FilterMenu
              label="Industry"
              multi
              options={industryOptions}
              selected={filters.industries}
              onChange={(industries) => set({ industries })}
            />
            <FilterMenu
              label="Where"
              options={geoOptions}
              selected={[filters.geo]}
              onChange={([geo]) => set({ geo: geo ?? "" })}
              width={280}
            />
            <FilterMenu
              label="Level"
              options={levelOptions}
              selected={[filters.level]}
              onChange={([level]) => set({ level: (level ?? "") as Level })}
              width={220}
            />

            {stageOptions.length ? (
              <FilterMenu
                label="Stage"
                multi
                options={stageOptions}
                selected={filters.stages}
                onChange={(stages) => set({ stages })}
                width={220}
              />
            ) : null}

            {tier1Count ? (
              <button
                type="button"
                onClick={() => set({ tier1: !filters.tier1 })}
                aria-pressed={filters.tier1}
                title="The company's latest round includes a fund on your tier 1 list"
                className={
                  "shrink-0 border-b pb-[2px] text-[14px] transition-colors " +
                  (filters.tier1
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground")
                }
              >
                Tier 1 backed <span className="opacity-60">{tier1Count}</span>
              </button>
            ) : null}
            <input
              type="search"
              value={filters.query}
              onChange={(e) => set({ query: e.target.value })}
              placeholder="Search role or company"
              aria-label="Search role or company"
              className="order-last w-full border-b border-hairline bg-transparent pb-1 text-[14px] outline-none placeholder:text-muted-foreground/70 focus:border-foreground sm:order-none sm:ml-auto sm:w-[220px]"
            />
          </div>
          {anyFilter ? (
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 pb-3 text-[13px]">
              {filters.industries.map((i) => (
                <Chip
                  key={i}
                  label={industryLabel(i)}
                  onClear={() => set({ industries: filters.industries.filter((x) => x !== i) })}
                />
              ))}
              {filters.geo ? (
                <Chip label={geoLabel(filters.geo)} onClear={() => set({ geo: "" })} />
              ) : null}
              {filters.level ? (
                <Chip
                  label={filters.level === "lead" ? "Lead a team" : "Individual"}
                  onClear={() => set({ level: "" })}
                />
              ) : null}
              {filters.tier1 ? (
                <Chip label="Tier 1 backed" onClear={() => set({ tier1: false })} />
              ) : null}
              {filters.stages.map((st) => (
                <Chip
                  key={st}
                  label={st}
                  onClear={() => set({ stages: filters.stages.filter((x) => x !== st) })}
                />
              ))}
              <button
                type="button"
                onClick={() => setFilters(emptyFilters)}
                className="text-muted-foreground hover:text-foreground"
              >
                Clear all
              </button>
              <span className="ml-auto text-muted-foreground/80">
                {results.length} {results.length === 1 ? "role" : "roles"}
              </span>
            </div>
          ) : null}
        </div>

        {isError ? (
          <p className="py-12 text-[15px]">The roles file did not load. Reload to try again.</p>
        ) : null}
        {isPending ? <p className="py-12 text-[14px] text-muted-foreground">Loading</p> : null}

        <div className="-mx-4 mt-8 flex flex-wrap items-baseline gap-x-6 px-4 text-[13px]">
          <span className="text-muted-foreground/80">Sort</span>
          <button
            type="button"
            onClick={() => setSort("posted")}
            aria-pressed={sort === "posted"}
            className={
              sort === "posted"
                ? "border-b border-foreground pb-[2px]"
                : "border-b border-transparent pb-[2px] text-muted-foreground hover:text-foreground"
            }
          >
            Newest posted
          </button>
          <button
            type="button"
            onClick={() => setSort("raised")}
            aria-pressed={sort === "raised"}
            className={
              sort === "raised"
                ? "border-b border-foreground pb-[2px]"
                : "border-b border-transparent pb-[2px] text-muted-foreground hover:text-foreground"
            }
          >
            Just raised
          </button>
        </div>

        {sort === "raised" ? (
          <section className="mt-6">
            <div className="-mx-4 flex items-baseline justify-between border-b border-foreground/80 px-4 pb-2">
              <h2 className="text-[12px] uppercase tracking-[0.1em]">Newest round first</h2>
              <span className="text-[12px] text-muted-foreground">{byFunding.length}</span>
            </div>
            <ul>
              {byFunding.slice(0, 80).map((r) => (
                <li key={r.id} className="-mx-4 border-b border-hairline px-4 py-[13px]">
                  <Link
                    to="/roles/$id"
                    params={{ id: r.id }}
                    className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 hover:text-primary"
                  >
                    <span className="text-[16px]">
                      {r.title}
                      <span className="ml-3 text-[14px] text-muted-foreground">{r.company}</span>
                    </span>
                    <span className="text-[13px] text-muted-foreground">
                      {r.funding
                        ? `${r.funding.round ?? "raised"}, ${r.funding.daysAgo}d ago${r.funding.tier1 ? " ●" : ""}`
                        : "no round on file"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {sort === "posted" &&
          groups.map((g) => (
            <section key={g.label} className="mt-10">
              <div className="-mx-4 flex items-baseline justify-between border-b border-foreground/80 px-4 pb-2">
                <h2 className="text-[12px] uppercase tracking-[0.1em]">{g.label}</h2>
                <span className="text-[12px] text-muted-foreground">{g.count}</span>
              </div>
              <ul>
                {g.items.map((item) =>
                  item.kind === "role" ? (
                    <RoleRow key={item.role.id} role={item.role} />
                  ) : (
                    <li key={`more-${item.companySlug}`} className="-mx-4 border-b border-hairline">
                      <Link
                        to="/companies/$slug"
                        params={{ slug: item.companySlug }}
                        className="block px-4 py-[11px] text-[14px] text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
                      >
                        + {item.count} more at {item.company}
                      </Link>
                    </li>
                  ),
                )}
              </ul>
            </section>
          ))}

        {!isPending && data && results.length === 0 ? (
          <div className="py-16">
            <p className="max-w-[46ch] text-[17px]">
              {single
                ? `No ${industryLabel(single).toLowerCase()} deployment roles${
                    filters.geo ? ` in ${geoLabel(filters.geo).toLowerCase()}` : ""
                  } on this run.`
                : "Nothing matches those filters."}
            </p>
            <EmptyHint roles={roles} filters={filters} />
            <button
              type="button"
              onClick={() => setFilters(emptyFilters)}
              className="mt-5 border-b border-foreground pb-[2px] text-[15px] hover:border-primary hover:text-primary"
            >
              Clear filters
            </button>
          </div>
        ) : null}
        <BriefingSignup
          className="mt-16 border-t border-hairline pt-12"
          heading="Do not read this page every week."
          note="The new roles come to you on Monday, with who just raised and who has only started hiring for deployment."
        />
        <div className="h-16" />
      </div>
    </SiteFrame>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      aria-label={`Remove ${label}`}
      className="group inline-flex items-baseline gap-[6px] text-foreground"
    >
      {label}
      <span aria-hidden="true" className="text-muted-foreground group-hover:text-foreground">
        ×
      </span>
    </button>
  );
}

/** When a search finds only customer-facing work that is not deployment, say where it is. */
function EmptyHint({
  roles,
  filters,
}: {
  roles: ReturnType<typeof filterRoles>;
  filters: Filters;
}) {
  const q = filters.query.trim().toLowerCase();
  if (!q) return null;
  const related = roles.filter(
    (r) =>
      r.relevance === "related" &&
      (r.title.toLowerCase().includes(q) || r.company.toLowerCase().includes(q)) &&
      (!filters.industries.length || filters.industries.some((i) => roleIndustryMatch(r, i))),
  );
  if (!related.length) return null;
  const first = related[0]!;
  return (
    <p className="mt-3 max-w-[54ch] text-[15px] text-muted-foreground">
      {related.length} customer-facing {related.length === 1 ? "role matches" : "roles match"} that{" "}
      {related.length === 1 ? "is" : "are"} not deployment work.{" "}
      <Link
        to="/companies/$slug"
        params={{ slug: first.companySlug }}
        className="border-b border-foreground/40 text-foreground hover:border-foreground"
      >
        See them on the company page
      </Link>
      .
    </p>
  );
}
