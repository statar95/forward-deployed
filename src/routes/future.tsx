import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteFrame } from "@/components/SiteFrame";
import { CompanyLogo } from "@/components/CompanyLogo";
import { FundingLine } from "@/components/FundingLine";
import { LivePulse } from "@/components/LivePulse";
import { BriefingSignup } from "@/components/BriefingSignup";
import { allCompanies, industryLabel, realIndustries, useDataset, type Company } from "@/lib/roles";

export const Route = createFileRoute("/future")({
  head: () => ({
    meta: [
      { title: "Roles before they are posted" },
      {
        name: "description",
        content:
          "Companies that just raised, companies building their first deployment team, and the ones we are watching for their first deployment role.",
      },
    ],
  }),
  component: FuturePage,
});

/**
 * The other half of a job board: who is about to hire.
 *
 * Every board shows what is posted, which is the moment you are last to know. This page shows the
 * companies a deployment role is coming from: they just raised, or they have just started hiring for
 * deployment at all, or we are watching their board because their product only works once someone puts
 * it inside a customer. None of it is guesswork: each line is a fact with the page it came from.
 */
function FuturePage() {
  const { data, isPending } = useDataset();
  const companies = data ? allCompanies(data) : [];

  const justRaised = companies
    .filter((c) => c.funding && c.funding.daysAgo <= 120)
    .sort((a, b) => (a.funding?.daysAgo ?? 0) - (b.funding?.daysAgo ?? 0));

  const starting = companies
    .filter((c) => c.signals?.newToDeployment)
    .sort((a, b) => (a.signals?.oldestOpenDays ?? 0) - (b.signals?.oldestOpenDays ?? 0));

  const watching = companies
    .filter((c) => c.watching && !c.liveRoles)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <SiteFrame>
      <div className="mx-auto max-w-[1180px] px-6 sm:px-10">
        <div className="mt-12 flex flex-wrap items-baseline justify-between gap-4 sm:mt-16">
          <h1 className="font-display max-w-[20ch] text-[34px] leading-[1.05] tracking-[-0.02em] sm:text-[48px]">
            Roles before they are posted.
          </h1>
          <LivePulse generated={data?.generated} />
        </div>
        <p className="mt-4 max-w-[60ch] text-[16px] leading-relaxed text-muted-foreground">
          A posted role is the moment you are last to know. These are the companies a deployment
          role is most likely to come from next: they just raised, they have only just started
          hiring for deployment, or their product is the kind that someone has to put inside a
          customer.{" "}
          <Link
            to="/"
            className="border-b border-foreground/40 text-foreground hover:border-foreground"
          >
            The live roles are here
          </Link>
          .
        </p>

        {isPending ? <p className="py-12 text-[14px] text-muted-foreground">Loading</p> : null}

        <Block
          head="Just raised"
          note="Money in, deployment hires next. Every figure comes from the company's own announcement."
          count={justRaised.length}
        >
          <ul>
            {justRaised.map((c) => (
              <li key={c.slug} className="-mx-4 border-b border-hairline px-4 py-[15px]">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <Link
                    to="/companies/$slug"
                    params={{ slug: c.slug }}
                    className="flex items-center gap-3 text-[17px] hover:text-primary"
                  >
                    <CompanyLogo company={c} size={22} />
                    {c.name}
                  </Link>
                  <span className="text-[13px] text-muted-foreground">
                    {c.liveRoles
                      ? `${c.liveRoles} deployment ${c.liveRoles === 1 ? "role" : "roles"} open`
                      : "no deployment role yet"}
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
          head="Building a deployment team now"
          note="Every deployment role they have open was posted in the last 60 days, so the team is being built now."
          count={starting.length}
        >
          <ul>
            {starting.map((c) => (
              <CompanyRow key={c.slug} company={c} />
            ))}
          </ul>
        </Block>

        <Block
          head="Watching"
          note="Their product only works once someone puts it inside a customer, so a deployment role is a question of when. We read their board several times a day."
          count={watching.length}
        >
          <ul>
            {watching.map((c) => (
              <CompanyRow key={c.slug} company={c} watching />
            ))}
          </ul>
        </Block>

        <p className="mt-14 max-w-[60ch] border-t border-hairline pt-6 text-[14px] leading-relaxed text-muted-foreground">
          Coming next: companies incorporated in the last few months in these industries, and
          companies that have just won the kind of work that needs people on the ground.
        </p>
        <BriefingSignup
          className="mt-14 border-t border-hairline pt-12"
          heading="Hear it on Monday, not when it is posted."
          note="The signals on this page, filtered to your industry, in one email a week."
        />
        <div className="h-16" />
      </div>
    </SiteFrame>
  );
}

function CompanyRow({ company, watching = false }: { company: Company; watching?: boolean }) {
  const s = company.signals;
  const industries = realIndustries(company.industries);
  return (
    <li className="-mx-4 border-b border-hairline">
      <Link
        to="/companies/$slug"
        params={{ slug: company.slug }}
        className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-[15px] transition-colors hover:bg-surface"
      >
        <CompanyLogo company={company} size={22} />
        <span className="text-[17px]">
          {company.name}
          <span className="ml-3 text-[13px] text-muted-foreground">
            {industries.length ? industries.map(industryLabel).join(", ") : "across industries"}
          </span>
        </span>
        <span className="text-right text-[13px] text-muted-foreground">
          {watching
            ? company.funding
              ? `${company.funding.round ?? "raised"}, ${company.funding.daysAgo}d ago`
              : "no deployment role yet"
            : `${s?.liveCore ?? 0} open, first one ${s?.oldestOpenDays ?? 0} days ago`}
        </span>
      </Link>
    </li>
  );
}

function Block({
  head,
  note,
  count,
  children,
}: {
  head: string;
  note: string;
  count: number;
  children: React.ReactNode;
}) {
  if (!count) return null;
  return (
    <section className="mt-12">
      <div className="-mx-4 flex items-baseline justify-between border-b border-foreground/80 px-4 pb-2">
        <h2 className="text-[12px] uppercase tracking-[0.1em]">{head}</h2>
        <span className="text-[12px] text-muted-foreground">{count}</span>
      </div>
      <p className="mt-3 max-w-[64ch] text-[14px] leading-relaxed text-muted-foreground">{note}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}
