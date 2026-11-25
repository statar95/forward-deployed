import { useState } from "react";
import type { Company } from "@/lib/roles";

/**
 * A company's own logo, or its initials set in the display serif.
 *
 * The fallback is deliberately plain. The coloured monogram tile this replaced was invented
 * decoration: it gave a company a house colour it had never chosen, and at a glance it read as
 * branding we had applied to them.
 */
export function CompanyLogo({
  company,
  size = 34,
}: {
  company: Pick<Company, "name" | "logo">;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const initials = company.name
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  if (!company.logo || failed) {
    return (
      <span
        aria-hidden="true"
        style={{ width: size, height: size }}
        className="font-display flex shrink-0 items-center justify-center border border-hairline text-[13px] text-muted-foreground"
      >
        {initials || "?"}
      </span>
    );
  }

  return (
    <img
      src={company.logo}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
      className="shrink-0 object-contain"
    />
  );
}
