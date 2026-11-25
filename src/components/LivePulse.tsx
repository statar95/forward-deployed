import { freshness } from "@/lib/freshness";

/**
 * A dot and a timestamp. The claim is small and checkable: the board says when it last ran, not
 * that it is "live". The dot only breathes while the number is still in hours.
 */
export function LivePulse({ generated, className = "" }: { generated?: string | undefined; className?: string }) {
  const f = freshness(generated);
  if (!f.text) return null;

  return (
    <span className={`inline-flex items-center gap-2 text-[13px] text-muted-foreground ${className}`}>
      <span className="relative flex h-[7px] w-[7px] shrink-0" aria-hidden="true">
        {f.live ? (
          <span className="pulse-ring absolute inset-0 rounded-full bg-[var(--signal)] opacity-60" />
        ) : null}
        <span
          className="relative h-[7px] w-[7px] rounded-full"
          style={{ background: f.live ? "var(--signal)" : "var(--muted-foreground)" }}
        />
      </span>
      {f.text}
    </span>
  );
}
