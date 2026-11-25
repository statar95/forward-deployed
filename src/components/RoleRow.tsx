import { Link } from "@tanstack/react-router";
import { ageLabel, ageOf, type Role } from "@/lib/roles";

/**
 * One role, one line, one link. Hover only tints the row.
 *
 * Rows used to open in place on hover, which pushed the next row down under the cursor: moving the mouse
 * one row landed it five rows further on. The detail now lives on the role's own page.
 */
export function RoleRow({ role, showCompany = true }: { role: Role; showCompany?: boolean }) {
  // "Costa Mesa, California, United States" is a two line row: the city carries the meaning.
  const city = role.locations?.[0]?.split(",")[0]?.trim();
  const extra = (role.locations?.length ?? 0) - 1;
  const where = city ? (extra > 0 ? `${city} +${extra}` : city) : role.remote ? "Remote" : "";
  const age = ageOf(role);

  return (
    <li className="-mx-4 border-b border-hairline">
      <Link
        to="/roles/$id"
        params={{ id: role.id }}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-1 px-4 py-[15px] outline-none transition-colors duration-150 hover:bg-surface focus-visible:bg-surface sm:grid-cols-[minmax(0,1fr)_180px_150px_44px]"
      >
        <span className="text-[16px] leading-snug sm:text-[17px]">{role.title}</span>
        <span className="text-right text-[13px] text-muted-foreground sm:hidden">
          {ageLabel(age)}
        </span>
        {showCompany ? (
          <span className="col-span-2 text-[14px] text-muted-foreground sm:col-span-1">
            {role.company}
            <span className="sm:hidden">{where ? `, ${where}` : ""}</span>
          </span>
        ) : (
          <span className="hidden sm:block" />
        )}
        <span className="hidden truncate text-[13px] text-muted-foreground/80 sm:block">
          {where}
          {role.remote && city ? ", remote" : ""}
        </span>
        <span className="hidden text-right text-[13px] text-muted-foreground/80 tabular-nums sm:block">
          {ageLabel(age)}
        </span>
      </Link>
    </li>
  );
}
