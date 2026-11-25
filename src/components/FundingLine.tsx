import { roundLine, type Backer, type CompanyFunding } from "@/lib/roles";

/**
 * The latest round in one sentence, with the page it came from. A green dot marks a tier-1 fund. The
 * figures are the announcement's own; the link lets anyone check them.
 */
export function FundingLine({
  funding,
  full = false,
  className = "",
}: {
  funding: CompanyFunding;
  /** Show every named investor, not only the leads. */
  full?: boolean;
  className?: string;
}) {
  const leads = funding.leads;
  const rest = funding.investors.filter((i) => !leads.some((l) => l.name === i.name));
  const shownRest = full ? rest : rest.filter((i) => i.tier1);

  return (
    <p className={`text-[15px] leading-relaxed text-muted-foreground ${className}`}>
      <span className="text-foreground">{roundLine(funding)}</span>
      {leads.length ? (
        <>
          {", led by "}
          <Names list={leads} />
        </>
      ) : null}
      {shownRest.length ? (
        <>
          {leads.length ? ", with " : ", from "}
          <Names list={shownRest} />
        </>
      ) : null}
      {". "}
      <a
        href={funding.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="whitespace-nowrap border-b border-foreground/30 hover:border-foreground hover:text-foreground"
      >
        Announcement
      </a>
    </p>
  );
}

function Names({ list }: { list: Backer[] }) {
  return (
    <>
      {list.map((b, i) => (
        <span key={b.name}>
          {i > 0 ? (i === list.length - 1 ? " and " : ", ") : ""}
          <span className={b.tier1 ? "text-foreground" : ""}>{b.name}</span>
          {b.tier1 ? (
            <span
              aria-label="tier 1 fund"
              title="Tier 1 fund"
              className="ml-[3px] inline-block h-[6px] w-[6px] translate-y-[-2px] rounded-full bg-[var(--signal)]"
            />
          ) : null}
        </span>
      ))}
    </>
  );
}
