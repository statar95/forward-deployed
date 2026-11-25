import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { SiteFrame } from "@/components/SiteFrame";
import { CompanyLogo } from "@/components/CompanyLogo";
import { LivePulse } from "@/components/LivePulse";
import { allCompanies, industryLabel, realIndustries, useDataset } from "@/lib/roles";

export const Route = createFileRoute("/companies/")({
  head: () => ({
    meta: [
      { title: "Companies hiring forward deployed engineers" },
      {
        name: "description",
        content:
          "Every company on the board, the industries it sells into, and how many forward deployed roles it has open now.",
      },
      { property: "og:title", content: "Companies hiring forward deployed engineers" },
      {
        property: "og:description",
        content:
          "Industries, live role counts and open deployment roles for every company we read.",
      },
    ],
  }),
  component: CompaniesPage,
});

function CompaniesPage() {
  const { data, isPending } = useDataset();
  const [query, setQuery] = useState("");
  const [hiringOnly, setHiringOnly] = useState(true);
  const [newOnly, setNewOnly] = useState(false);
  // Raised in the last 90 days, by the announcement's date. Most recent raise first.
  const [raisedOnly, setRaisedOnly] = useState(false);

  const companies = useMemo(() => (data ? allCompanies(data) : []), [data]);
  const q = query.trim().toLowerCase();
  const raised = (c: (typeof companies)[number]) => c.funding != null && c.funding.daysAgo <= 90;
  const shown = companies
    .filter(
      (c) =>
        (!q || c.name.toLowerCase().includes(q)) &&
        (!hiringOnly || c.roleCount > 0) &&
        (!newOnly || Boolean(c.signals?.newToDeployment)) &&
        (!raisedOnly || raised(c)),
    )
    .sort((a, b) => (raisedOnly ? (a.funding?.daysAgo ?? 999) - (b.funding?.daysAgo ?? 999) : 0));
  const raisedCount = companies.filter(raised).length;
  const hiring = companies.filter((c) => c.roleCount > 0).length;
  const newCount = companies.filter((c) => c.signals?.newToDeployment).length;
  const hasSignals = companies.some((c) => c.signals);

  return (
    <SiteFrame>
      <div className="mx-auto max-w-[1180px] px-6 sm:px-10">
        <div className="mt-12 flex flex-wrap items-baseline justify-between gap-4 sm:mt-16">
          <h1 className="font-display max-w-[20ch] text-[32px] leading-[1.05] tracking-[-0.02em] sm:text-[44px]">
            Who is hiring on the ground
          </h1>
          <LivePulse generated={data?.generated} />
        </div>
        <p className="mt-5 max-w-[56ch] text-[16px] leading-relaxed text-muted-foreground">
          Every board we read, and what each company sells into. A company stays here when it has
          nothing open, so you can watch it rather than lose it.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-hairline pb-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search companies"
            aria-label="Search companies"
            className="w-full max-w-[260px] border-b border-hairline bg-transparent pb-1 text-[14px] outline-none placeholder:text-muted-foreground/70 focus:border-foreground"
          />
          <button
            type="button"
            onClick={() => setHiringOnly((v) => !v)}
            aria-pressed={hiringOnly}
            className={
              hiringOnly
                ? "border-b border-foreground pb-[2px] text-[14px]"
                : "border-b border-transparent pb-[2px] text-[14px] text-muted-foreground hover:text-foreground"
            }
          >
            Hiring now {hiring}
          </button>
          {hasSignals ? (
            <>
              <button
                type="button"
                onClick={() => setNewOnly((v) => !v)}
                aria-pressed={newOnly}
                title="Every deployment role they have open was posted in the last 60 days"
                className={
                  newOnly
                    ? "border-b border-foreground pb-[2px] text-[14px]"
                    : "border-b border-transparent pb-[2px] text-[14px] text-muted-foreground hover:text-foreground"
                }
              >
                New to deployment {newCount}
              </button>
              {raisedCount ? (
                <button
                  type="button"
                  onClick={() => setRaisedOnly((v) => !v)}
                  aria-pressed={raisedOnly}
                  title="Announced a funding round in the last 90 days"
                  className={
                    raisedOnly
                      ? "border-b border-foreground pb-[2px] text-[14px]"
                      : "border-b border-transparent pb-[2px] text-[14px] text-muted-foreground hover:text-foreground"
                  }
                >
                  Raised in 90 days {raisedCount}
                </button>
              ) : null}
            </>
          ) : null}
          <span className="ml-auto text-[13px] text-muted-foreground/80">
            {isPending ? "Loading" : `${shown.length} showing`}
          </span>
        </div>

        <ul>
          {shown.map((c) => (
            <li
              key={c.slug}
              className="-mx-4 border-b border-hairline px-4 transition-colors hover:bg-surface"
            >
              <Link
                to="/companies/$slug"
                params={{ slug: c.slug }}
                className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-x-5 gap-y-1 py-[15px] sm:grid-cols-[34px_minmax(0,1fr)_260px_130px]"
              >
                <CompanyLogo company={c} />
                <span className="text-[17px] leading-snug">
                  {c.name}
                  {c.signals?.newToDeployment ? (
                    <span className="ml-2 align-middle text-[11px] text-[var(--signal)]">
                      new to deployment
                    </span>
                  ) : null}
                </span>
                <span className="hidden truncate text-[13px] text-muted-foreground sm:block">
                  {realIndustries(c.industries).length
                    ? realIndustries(c.industries).map(industryLabel).join(", ")
                    : "sells across industries"}
                </span>
                <span className="text-right text-[13px] text-muted-foreground/80">
                  {raisedOnly && c.funding
                    ? `${c.funding.round ?? "raised"}, ${c.funding.daysAgo}d ago`
                    : c.roleCount === 0
                      ? "nothing open"
                      : `${c.roleCount} open`}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        {!isPending && shown.length === 0 ? (
          <p className="py-16 text-[17px]">No company matches that search.</p>
        ) : (
          <div className="h-8" />
        )}
      </div>
    </SiteFrame>
  );
}
