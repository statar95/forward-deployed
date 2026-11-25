import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteFrame } from "@/components/SiteFrame";
import { CompanyLogo } from "@/components/CompanyLogo";
import { RoleRow } from "@/components/RoleRow";
import { ApplyLink } from "@/components/ApplyGate";
import { FundingLine } from "@/components/FundingLine";
import { SaveRole } from "@/components/SaveRole";
import {
  ageOf,
  allCompanies,
  industriesOf,
  industryLabel,
  postedLine,
  realIndustries,
  roleIndustryMatch,
  useDataset,
  type Role,
} from "@/lib/roles";

export const Route = createFileRoute("/roles/$id")({
  head: () => ({
    meta: [
      { title: "Deployment role" },
      {
        name: "description",
        content: "A forward deployed or deployment role, read from the company's own job board.",
      },
    ],
  }),
  component: RolePage,
});

/**
 * One role, at an address you can send to a friend. The listing text is never shown: it belongs to the
 * company and is full of recruiter contact details. What we add is what the listing does not say: when it
 * was posted, why it is on this board, and what the company's hiring looks like.
 */
function RolePage() {
  const { id } = Route.useParams();
  const { data, isPending } = useDataset();

  if (isPending || !data) {
    return (
      <SiteFrame>
        <p className="mx-auto max-w-[1180px] px-6 py-16 text-[14px] text-muted-foreground sm:px-10">
          Loading
        </p>
      </SiteFrame>
    );
  }

  const role = data.roles.find((r) => r.id === id);
  if (!role) {
    return (
      <SiteFrame>
        <div className="mx-auto max-w-[1180px] px-6 py-16 sm:px-10">
          <h1 className="font-display max-w-[20ch] text-[34px] leading-[1.05] tracking-[-0.02em]">
            This role has left the board
          </h1>
          <p className="mt-4 max-w-[52ch] text-[16px] leading-relaxed text-muted-foreground">
            It was not on the company's board the last time we read it. It has most likely been filled
            or taken down.
          </p>
          <Link
            to="/"
            className="mt-6 inline-block border-b border-foreground pb-[2px] text-[15px] hover:border-primary hover:text-primary"
          >
            See every live role
          </Link>
        </div>
      </SiteFrame>
    );
  }

  const company = allCompanies(data).find((c) => c.slug === role.companySlug);
  const s = company?.signals;
  const others = data.roles.filter(
    (r) => r.companySlug === role.companySlug && r.id !== role.id && r.relevance === "core",
  );
  const industries = industriesOf(role);
  const primary = industries[0];
  const similar = primary
    ? data.roles
        .filter(
          (r) =>
            r.id !== role.id &&
            r.relevance === "core" &&
            r.companySlug !== role.companySlug &&
            roleIndustryMatch(r, primary) &&
            ageOf(r) <= 30,
        )
        .sort((a, b) => ageOf(a) - ageOf(b))
    : [];
  const where = [...(role.locations ?? []).slice(0, 3)].join("; ");

  return (
    <SiteFrame>
      <div className="mx-auto max-w-[1180px] px-6 sm:px-10">
        <Link
          to="/"
          className="mt-10 inline-block text-[13px] text-muted-foreground hover:text-foreground sm:mt-12"
        >
          Roles
        </Link>

        <h1 className="font-display mt-5 max-w-[24ch] text-[34px] leading-[1.05] tracking-[-0.02em] sm:text-[48px]">
          {role.title}
        </h1>

        <p className="mt-5 max-w-[70ch] text-[15px] leading-relaxed text-muted-foreground">
          <Link
            to="/companies/$slug"
            params={{ slug: role.companySlug }}
            className="text-foreground hover:text-primary"
          >
            {role.company}
          </Link>
          {industries.length ? ` · ${industries.map(industryLabel).join(", ")}` : ""}
          {where ? ` · ${where}` : ""}
          {role.remote ? " · remote" : ""}
        </p>
        {postedLine(role) ? (
          <p className="mt-1 text-[15px] text-muted-foreground">{postedLine(role)}</p>
        ) : null}

        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
          <ApplyLink
            role={role}
            className="tap inline-flex items-center border border-foreground px-6 text-[16px] transition-colors hover:bg-foreground hover:text-background"
          />
          <SaveRole role={role} />
        </div>

        <div className="mt-12 grid max-w-[980px] gap-x-12 gap-y-10 border-t border-hairline pt-8 sm:grid-cols-2">
          <Block head="Why it is here">
            <p>{whyHere(role)}</p>
            {industries.length ? <p className="mt-2">{whyIndustry(role, industries)}</p> : null}
          </Block>

          {/* The chief executive is not who you talk to about a delivery role, and offering them as
              the route in was worse than offering nothing: it reads as advice and it is bad advice.
              Of 693 live core listings, 67% name a team and only 5% name a reporting line, and even
              those name a title rather than a person. So this block says what the listing actually
              says, and stops. The named hiring manager is a real piece of work, not a fallback. */}
          <Block head="Where this sits">
            <p>
              {role.team
                ? `Listed under ${role.team} on ${role.company}'s board.`
                : `${role.company}'s board does not say which team this sits in.`}{" "}
              The listing names no hiring manager, which is normal: almost none of them do.
            </p>
          </Block>

          {company ? (
            <Block head={role.company}>
              <div className="flex items-center gap-3">
                <CompanyLogo company={company} size={28} />
                <span className="text-foreground">
                  {others.length
                    ? `${others.length + 1} deployment roles open`
                    : "This is their only deployment role open"}
                </span>
              </div>
              {company.funding ? <FundingLine funding={company.funding} className="mt-3" /> : null}
              {s?.newToDeployment ? (
                <p className="mt-3">
                  <span className="text-[var(--signal)]">New to deployment hiring.</span> Every
                  deployment role open here was posted in the last 60 days.
                </p>
              ) : null}
              {s && s.openedLast30 > 0 ? (
                <p className="mt-2">
                  {s.openedLast30} posted in the last 30 days.
                  {s.oldestOpenDays != null && s.oldestOpenDays > 30
                    ? ` The oldest has been up ${s.oldestOpenDays} days.`
                    : ""}
                </p>
              ) : null}
              <Link
                to="/companies/$slug"
                params={{ slug: role.companySlug }}
                className="mt-3 inline-block border-b border-foreground/40 text-foreground hover:border-foreground"
              >
                {others.length
                  ? `Other roles at ${role.company} (${others.length})`
                  : `About ${role.company}`}
              </Link>
            </Block>
          ) : null}
        </div>

        {similar.length ? (
          <section className="mt-14">
            <div className="-mx-4 flex items-baseline justify-between border-b border-foreground/80 px-4 pb-2">
              <h2 className="text-[12px] uppercase tracking-[0.1em]">
                More in {industryLabel(primary!).toLowerCase()}, posted this month
              </h2>
              <Link
                to="/"
                search={{ industry: primary }}
                className="text-[12px] text-muted-foreground hover:text-foreground"
              >
                All {similar.length}
              </Link>
            </div>
            <ul>
              {similar.slice(0, 5).map((r) => (
                <RoleRow key={r.id} role={r} />
              ))}
            </ul>
          </section>
        ) : null}
        <div className="h-16" />
      </div>
    </SiteFrame>
  );
}

function Block({ head, children }: { head: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-[12px] uppercase tracking-[0.1em] text-foreground">{head}</h2>
      <div className="mt-3 max-w-[46ch] text-[15px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

function whyHere(role: Role) {
  const reason = role.relevanceReason?.trim();
  if (!reason) return "The title is a deployment role.";
  return `Deployment work: ${reason}.`;
}

function whyIndustry(role: Role, industries: string[]) {
  const own = realIndustries(role.industries);
  const names = (list: string[]) => list.map(industryLabel).join(", ").toLowerCase();
  if (own.length && role.industrySource === "title") return `Tagged ${names(own)} from the title.`;
  if (own.length && role.industrySource === "description")
    return `Tagged ${names(own)} because the listing names it more than once.`;
  if (own.length) return `Tagged ${names(own)} by hand.`;
  return `The role itself names no industry; ${role.company} sells into ${names(industries)}.`;
}
