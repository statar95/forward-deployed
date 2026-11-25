import { Link } from "@tanstack/react-router";
import { money, type Company } from "@/lib/roles";

/**
 * The roles that do not exist yet.
 *
 * A company that just raised and has posted nothing is the most useful row on the board, because
 * everyone else finds out when the job appears. The row carries the one thing you can act on, which
 * is who runs the place, taken from a page the company published itself.
 *
 * It sits above the list rather than inside it. Seven of these twelve companies have no role anywhere
 * in our data, so there is no country to derive, and the list below is headed "United Kingdom". Mixing
 * them would make that heading untrue.
 */
export function AboutToHire({ companies }: { companies: Company[] }) {
  if (!companies.length) return null;

  return (
    <section className="mt-10">
      <div className="-mx-4 flex items-baseline justify-between border-b border-foreground/80 px-4 pb-2">
        <h2 className="text-[12px] uppercase tracking-[0.1em]">Before the job exists</h2>
        <span className="text-[12px] text-muted-foreground">{companies.length}</span>
      </div>
      <p className="mt-3 max-w-[64ch] text-[14px] leading-relaxed text-muted-foreground">
        Money in, nothing posted. Every figure is from the company's own announcement, and the name
        is from a page they published. Where they will hire is not announced yet either.
      </p>
      <ul className="mt-2">
        {companies.map((c) => (
          <Row key={c.slug} company={c} />
        ))}
      </ul>
    </section>
  );
}

function Row({ company }: { company: Company }) {
  const f = company.funding!;
  const amount = money(f.amount ?? null, f.currency ?? null);
  const event = [f.round, amount].filter(Boolean).join(", ");
  const who = company.founder?.name;

  return (
    <li className="-mx-4 border-b border-hairline">
      <Link
        to="/companies/$slug"
        params={{ slug: company.slug }}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-1 px-4 py-[15px] outline-none transition-colors duration-150 hover:bg-surface focus-visible:bg-surface sm:grid-cols-[minmax(0,1fr)_180px_150px_44px]"
      >
        <span className="text-[16px] leading-snug sm:text-[17px]">
          <span className="text-[var(--signal)]">Raised</span> {event || "a round"}
        </span>
        <span className="text-right text-[13px] text-muted-foreground sm:hidden">{f.daysAgo}d</span>
        <span className="col-span-2 text-[14px] text-muted-foreground sm:col-span-1">
          {company.name}
        </span>
        <span className="hidden truncate text-[13px] text-muted-foreground/80 sm:block">
          {who ? `Talk to ${who}` : ""}
        </span>
        <span className="hidden text-right text-[13px] text-muted-foreground/80 tabular-nums sm:block">
          {f.daysAgo}d
        </span>
      </Link>
    </li>
  );
}
