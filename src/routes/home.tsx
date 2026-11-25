import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { SiteFrame } from "@/components/SiteFrame";
import { RoleRow } from "@/components/RoleRow";
import { CompanyLogo } from "@/components/CompanyLogo";
import { SignInDialog } from "@/components/SignInDialog";
import { Onboarding } from "@/components/Onboarding";
import { FundingLine } from "@/components/FundingLine";
import { BriefingSignup } from "@/components/BriefingSignup";
import {
  ageOf,
  allCompanies,
  industryLabel,
  inSpace,
  useDataset,
  type Company,
  type Role,
  type Space,
} from "@/lib/roles";
import { authEnabled, useCandidate, useSavedRoles } from "@/lib/auth";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Your briefing" },
      {
        name: "description",
        content: "Deployment roles, new hiring and new funding in your industry.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: HomePage,
});

/**
 * The cockpit: what is new in your space, who is about to hire, who just raised, and what you saved.
 * Everything is computed in the browser by joining the public roles file with the private profile, so
 * there is no server and nothing about a candidate is ever in the published data.
 */
function HomePage() {
  const { data } = useDataset();
  const { candidate, loading, save, user } = useCandidate();
  const { saved, toggle, isSaved } = useSavedRoles();
  const [asking, setAsking] = useState(false);

  // Until VITE_APPLY_GATE is on there is no account to sign into, so /home is the sign-up itself:
  // the briefing arrives by email and this page becomes the cockpit later, for the same address.
  if (!authEnabled) {
    return (
      <Shell>
        <h1 className="font-display max-w-[20ch] text-[34px] leading-[1.05] tracking-[-0.02em] sm:text-[46px]">
          Your briefing arrives by email.
        </h1>
        <p className="mt-4 max-w-[52ch] text-[16px] leading-relaxed text-muted-foreground">
          One email on Monday: the new roles in your industry, who just raised, and the companies
          that have only just started hiring for deployment. No account to open.
        </p>
        <BriefingSignup className="mt-10" heading="Tell us where you have worked." />
        <Back />
      </Shell>
    );
  }

  if (loading || !data) {
    return (
      <Shell>
        <p className="text-[14px] text-muted-foreground">Loading</p>
      </Shell>
    );
  }

  if (!user) {
    return (
      <Shell>
        <h1 className="font-display max-w-[20ch] text-[34px] leading-[1.05] tracking-[-0.02em] sm:text-[46px]">
          Your briefing, once you sign in.
        </h1>
        <p className="mt-4 max-w-[52ch] text-[16px] leading-relaxed text-muted-foreground">
          Four questions about your industry and where you can work, then a page with only your
          slice of the board on it: new roles, companies building a deployment team, and who just
          raised.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="tap inline-flex items-center border border-foreground px-6 text-[16px] transition-colors hover:bg-foreground hover:text-background"
          >
            Build my briefing
          </button>
          <Link
            to="/"
            className="border-b border-foreground pb-[2px] text-[16px] hover:border-primary hover:text-primary"
          >
            Or see every role
          </Link>
        </div>
        {asking ? (
          <SignInDialog reason="to build your briefing" onClose={() => setAsking(false)} />
        ) : null}
      </Shell>
    );
  }

  if (!candidate?.onboarded_at) {
    return (
      <SiteFrame>
        {candidate ? (
          <Onboarding data={data} candidate={candidate} onDone={(p) => void save(p)} />
        ) : null}
      </SiteFrame>
    );
  }

  const space: Space = {
    industries: candidate.industries ?? [],
    countries: candidate.countries ?? [],
    horizontal: candidate.horizontal ?? true,
    level: candidate.level,
  };
  const companies = allCompanies(data);
  const mine = data.roles.filter((r) => inSpace(r, space)).sort((a, b) => ageOf(a) - ageOf(b));

  // "New" widens from a week to a month when a week is thin, and says which it is showing.
  const week = mine.filter((r) => ageOf(r) <= 7);
  const fresh = week.length >= 3 ? week : mine.filter((r) => ageOf(r) <= 30);
  const window = week.length >= 3 ? "this week" : "this month";

  const inMine = (c: Company) =>
    !space.industries.length ||
    space.industries.some((i) => (c.industries ?? []).includes(i)) ||
    data.roles.some((r) => r.companySlug === c.slug && inSpace(r, space));

  const building = companies
    .filter((c) => c.signals?.newToDeployment && inMine(c))
    .sort((a, b) => (a.signals?.oldestOpenDays ?? 0) - (b.signals?.oldestOpenDays ?? 0));

  const funded = companies
    .filter((c) => c.funding && c.funding.daysAgo <= 90 && inMine(c))
    .sort((a, b) => (a.funding?.daysAgo ?? 0) - (b.funding?.daysAgo ?? 0));

  const savedRoles = saved
    .map((s) => data.roles.find((r) => r.id === s.role_id))
    .filter(Boolean) as Role[];

  const label = [
    (candidate.industries ?? []).map(industryLabel).join(", ") || "Every industry",
    (candidate.countries ?? []).join(", ") || "Anywhere",
    candidate.level === "lead" ? "Lead" : candidate.level === "ic" ? "Individual" : null,
  ].filter(Boolean);

  return (
    <SiteFrame>
      <div className="mx-auto max-w-[1180px] px-6 sm:px-10">
        <div className="mt-12 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 sm:mt-16">
          <h1 className="font-display text-[30px] leading-[1.05] tracking-[-0.02em] sm:text-[40px]">
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </h1>
          <Link to="/profile" className="text-[13px] text-muted-foreground hover:text-foreground">
            Edit
          </Link>
        </div>
        <p className="mt-2 text-[15px] text-muted-foreground">{label.join(" · ")}</p>

        <Block
          head={`New in your space, ${window}`}
          count={fresh.length}
          empty="Nothing new in your industries this month. The board is read several times a day."
        >
          <ul>
            {fresh.slice(0, 12).map((r) => (
              <RoleRow key={r.id} role={r} />
            ))}
          </ul>
          {mine.length > fresh.length ? (
            <Link
              to="/"
              search={{
                industry: (candidate.industries ?? []).join(",") || undefined,
                level: candidate.level || undefined,
              }}
              className="mt-4 inline-block border-b border-foreground pb-[2px] text-[15px] hover:border-primary hover:text-primary"
            >
              All {mine.length} roles in your space
            </Link>
          ) : null}
        </Block>

        <Block
          head="Building a deployment team now"
          count={building.length}
          empty="No company in your industries has only just started hiring for deployment."
        >
          <ul>
            {building.slice(0, 8).map((c) => (
              <li key={c.slug} className="-mx-4 border-b border-hairline">
                <Link
                  to="/companies/$slug"
                  params={{ slug: c.slug }}
                  className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-[13px] transition-colors hover:bg-surface"
                >
                  <CompanyLogo company={c} size={22} />
                  <span className="text-[16px]">
                    {c.name}
                    <span className="ml-3 text-[13px] text-muted-foreground">
                      {c.signals?.liveCore} {c.signals?.liveCore === 1 ? "role" : "roles"}, first
                      one {c.signals?.oldestOpenDays} days ago
                    </span>
                  </span>
                  {c.funding && c.funding.daysAgo <= 180 ? (
                    <span className="text-right text-[13px] text-[var(--signal)]">
                      {c.funding.round ?? "raised"}
                    </span>
                  ) : (
                    <span />
                  )}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] text-muted-foreground">
            Every deployment role at these companies was posted in the last 60 days.
          </p>
        </Block>

        <Block
          head="Just funded in your space"
          count={funded.length}
          empty="No company in your industries has announced a round in the last 90 days."
        >
          <ul>
            {funded.slice(0, 8).map((c) => (
              <li key={c.slug} className="-mx-4 border-b border-hairline px-4 py-[13px]">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <Link
                    to="/companies/$slug"
                    params={{ slug: c.slug }}
                    className="text-[16px] hover:text-primary"
                  >
                    {c.name}
                  </Link>
                  <span className="text-[13px] text-muted-foreground">
                    {c.signals?.liveCore
                      ? `hiring ${c.signals.liveCore}`
                      : "not hiring deployment yet"}
                  </span>
                </div>
                {c.funding ? (
                  <FundingLine funding={c.funding} className="mt-1 text-[14px]" />
                ) : null}
              </li>
            ))}
          </ul>
        </Block>

        <Block
          head="Your roles"
          count={savedRoles.length}
          empty="Nothing saved yet. Open a role and press Save to keep it here."
        >
          <ul>
            {savedRoles.map((r) => (
              <li
                key={r.id}
                className="-mx-4 flex items-baseline gap-4 border-b border-hairline px-4"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    to="/roles/$id"
                    params={{ id: r.id }}
                    className="block py-[13px] text-[16px] hover:text-primary"
                  >
                    {r.title}
                    <span className="ml-3 text-[14px] text-muted-foreground">{r.company}</span>
                  </Link>
                  {r.team ? (
                    <p className="-mt-2 pb-3 text-[13px] text-muted-foreground">
                      Listed under {r.team}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void toggle({ id: r.id, company: r.company, title: r.title })}
                  className="shrink-0 text-[13px] text-muted-foreground hover:text-foreground"
                >
                  {isSaved(r.id) ? "Remove" : "Save"}
                </button>
              </li>
            ))}
          </ul>
        </Block>
        <div className="h-16" />
      </div>
    </SiteFrame>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SiteFrame>
      <div className="mx-auto max-w-[1180px] px-6 py-16 sm:px-10 sm:py-24">{children}</div>
    </SiteFrame>
  );
}

function Back() {
  return (
    <Link
      to="/"
      className="mt-6 inline-block border-b border-foreground pb-[2px] text-[15px] hover:border-primary hover:text-primary"
    >
      See every live role
    </Link>
  );
}

function Block({
  head,
  count,
  empty,
  children,
}: {
  head: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <div className="-mx-4 flex items-baseline justify-between border-b border-foreground/80 px-4 pb-2">
        <h2 className="text-[12px] uppercase tracking-[0.1em]">{head}</h2>
        <span className="text-[12px] text-muted-foreground">{count}</span>
      </div>
      {count ? (
        children
      ) : (
        <p className="max-w-[56ch] py-6 text-[15px] leading-relaxed text-muted-foreground">
          {empty}
        </p>
      )}
    </section>
  );
}
