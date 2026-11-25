import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteFrame } from "@/components/SiteFrame";
import { CompanyLogo } from "@/components/CompanyLogo";
import { RoleRow } from "@/components/RoleRow";
import { FundingLine } from "@/components/FundingLine";
import {
  allCompanies,
  industryLabel,
  realIndustries,
  useDataset,
  type Company,
  type CompanySignals,
} from "@/lib/roles";

export const Route = createFileRoute("/companies/$slug")({
  head: () => ({
    meta: [
      { title: "Company roles" },
      {
        name: "description",
        content: "Open forward deployed roles at this company, with the industries it sells into.",
      },
    ],
  }),
  component: CompanyPage,
});

function CompanyPage() {
  const { slug } = Route.useParams();
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

  const company = allCompanies(data).find((c) => c.slug === slug);
  const roles = data.roles.filter((r) => r.companySlug === slug);

  if (!company) {
    return (
      <SiteFrame>
        <div className="mx-auto max-w-[1180px] px-6 py-16 sm:px-10">
          <h1 className="font-display text-[32px] leading-[1.05] tracking-[-0.02em]">
            No company on file for "{slug}"
          </h1>
          <Link
            to="/companies"
            className="mt-6 inline-block border-b border-foreground pb-[2px] text-[15px] hover:border-primary hover:text-primary"
          >
            Back to companies
          </Link>
        </div>
      </SiteFrame>
    );
  }

  const core = roles.filter((r) => r.relevance === "core").length;

  return (
    <SiteFrame>
      <div className="mx-auto max-w-[1180px] px-6 sm:px-10">
        <Link
          to="/companies"
          className="mt-10 inline-block text-[13px] text-muted-foreground hover:text-foreground sm:mt-12"
        >
          Companies
        </Link>

        <div className="mt-5 flex flex-wrap items-center gap-5">
          <CompanyLogo company={company} size={52} />
          <h1 className="font-display text-[34px] leading-[1.05] tracking-[-0.02em] sm:text-[46px]">
            {company.name}
          </h1>
        </div>

        <p className="mt-5 max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground">
          {roles.length === 0
            ? "Nothing open on their board today."
            : `${roles.length} ${roles.length === 1 ? "role" : "roles"} on the board${
                core && core !== roles.length ? `, ${core} of them core deployment work` : ""
              }.`}{" "}
          {realIndustries(company.industries).length
            ? `Sells into ${realIndustries(company.industries).map(industryLabel).join(", ").toLowerCase()}.`
            : "Sells across industries rather than into one."}
          {company.board ? ` Board read from ${company.board}.` : ""}
        </p>

        {company.funding ? (
          <FundingLine funding={company.funding} full className="mt-3 max-w-[70ch]" />
        ) : null}

        {company.founder ? (
          <p className="mt-3 max-w-[70ch] text-[15px] leading-relaxed text-muted-foreground">
            Led by <span className="text-foreground">{company.founder.name}</span>
            {company.founder.title ? `, ${company.founder.title}` : ""}.{" "}
            <a
              href={company.founder.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="border-b border-foreground/30 hover:border-foreground hover:text-foreground"
            >
              Where this is from
            </a>
          </p>
        ) : null}

        {company.news?.length ? <JustAnnounced items={company.news} /> : null}

        {company.signals ? <Signals s={company.signals} /> : null}

        {roles.length === 0 ? (
          <div className="mt-10 border-t border-hairline pt-8">
            <p className="max-w-[54ch] text-[17px]">
              The page stays here while they are quiet, so you can come back rather than lose them.
            </p>
            <Link
              to="/"
              className="mt-5 inline-block border-b border-foreground pb-[2px] text-[15px] hover:border-primary hover:text-primary"
            >
              See every live role
            </Link>
          </div>
        ) : (
          <ul className="mt-9 border-t border-hairline">
            {roles.map((role) => (
              <RoleRow key={role.id} role={role} showCompany={false} />
            ))}
          </ul>
        )}
      </div>
    </SiteFrame>
  );
}

/**
 * What their board says about hiring intent, from our own archive. Only numbers we can stand behind
 * appear: closures and the net change stay hidden until we have watched the company for 30 days.
 */
function Signals({ s }: { s: CompanySignals }) {
  const figures: { n: string; label: string }[] = [];
  figures.push({
    n: String(s.openedLast30),
    label: `deployment ${s.openedLast30 === 1 ? "role" : "roles"} posted in the last 30 days`,
  });
  if (s.net30 != null)
    figures.push({
      n: s.net30 > 0 ? `+${s.net30}` : String(s.net30),
      label: `net change over 30 days, after ${s.closedLast30} closed`,
    });
  if (s.oldestOpenDays != null)
    figures.push({
      n: String(s.oldestOpenDays),
      label: "days the oldest open deployment role has been up",
    });
  if (s.medianDaysToClose != null)
    figures.push({
      n: String(s.medianDaysToClose),
      label: "days a deployment role stays up here before it closes, the median",
    });

  return (
    <div className="mt-9 max-w-[820px] border-t border-hairline pt-7">
      {s.newToDeployment ? (
        <p className="max-w-[60ch] text-[15px] leading-relaxed">
          <span className="text-[var(--signal)]">New to deployment hiring.</span>{" "}
          <span className="text-muted-foreground">
            Every deployment role open here was posted in the last 60 days, so the team is being
            built now.
          </span>
        </p>
      ) : null}
      {s.longOpen > 0 ? (
        <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground">
          {s.longOpen === 1 ? "One role has" : `${s.longOpen} roles have`} been open between three
          months and a year. They are finding {s.longOpen === 1 ? "it" : "them"} hard to fill.
        </p>
      ) : null}
      <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
        {figures.map((f) => (
          <div key={f.label}>
            <dt className="font-display text-[34px] leading-none tracking-[-0.02em]">{f.n}</dt>
            <dd className="mt-2 max-w-[22ch] text-[13px] leading-snug text-muted-foreground">
              {f.label}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}


/**
 * What this company has just said, in their own words, linking to their own page.
 *
 * This is the reason to write to someone this week. Advice about cold outreach is worth nothing
 * without a specific: "you just signed X" opens a conversation, "I admire your work" does not.
 *
 * Headline, date and link only, never a word of the article. It is their copyrighted text, the same
 * rule the board applies to job descriptions.
 */
function JustAnnounced({ items }: { items: NonNullable<Company["news"]> }) {
  return (
    <section className="mt-8 border-t border-hairline pt-6">
      <h2 className="text-[12px] uppercase tracking-[0.1em] text-muted-foreground">Just announced</h2>
      <ul className="mt-3">
        {items.map((n) => (
          <li key={n.url} className="border-b border-hairline last:border-0">
            <a
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-[11px] text-[15px] transition-colors hover:text-primary"
            >
              <span className="max-w-[62ch] leading-snug">{n.title}</span>
              <span className="text-[13px] text-muted-foreground">{n.date}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-3 max-w-[60ch] text-[13px] text-muted-foreground">
        From their own site. A specific like this is what makes a message to a hiring manager worth
        reading.
      </p>
    </section>
  );
}
