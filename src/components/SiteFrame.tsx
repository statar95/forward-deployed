import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Mark } from "@/components/Mark";
import { useState } from "react";
import { authEnabled, useSession } from "@/lib/auth";
import { SignInDialog } from "@/components/SignInDialog";

// No "Roles" entry: the board is the front page now, and the wordmark on the left already goes
// there, so a nav item for it would be a second control for the same destination.
const nav = [
  { to: "/future", label: "Future roles" },
  { to: "/briefing", label: "The briefing" },
  { to: "/companies", label: "Companies" },
] as const;

/**
 * The header is sticky on every page, so the way home is always on screen. It used to scroll away
 * behind the roles page's industry bar, which left no route back to the landing page at all.
 */
export function SiteFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-hairline bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-6 px-6 py-4 sm:px-10">
          <Link
            to="/"
            aria-label="Forward Deployed, home"
            className="group flex items-center gap-[10px] text-foreground"
          >
            <Mark size={24} />
            <span className="font-display text-[21px] leading-none tracking-[-0.01em] group-hover:text-primary">
              Forward Deployed
            </span>
          </Link>
          <nav className="flex items-center gap-5 text-[14px] sm:gap-7">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeProps={{ className: "text-foreground" }}
                inactiveProps={{ className: "text-muted-foreground hover:text-foreground" }}
                className="transition-colors"
              >
                {item.label}
              </Link>
            ))}
            <Account />
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="mt-24 border-t border-hairline">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-baseline justify-between gap-6 px-6 py-9 text-[13px] text-muted-foreground sm:px-10">
          <p className="max-w-[62ch]">
            Read several times a day from each company's own job board. Roles link straight to the
            company's page. Logos identify the employer whose role is listed and imply nothing more.
          </p>
          <div className="flex flex-col gap-1 sm:items-end">
            <Link to="/" className="hover:text-foreground">
              Forward Deployed
            </Link>
            <p>
              A project by{" "}
              <a
                href="https://emergecapital.vc"
                target="_blank"
                rel="noopener noreferrer"
                className="border-b border-foreground/30 hover:border-foreground hover:text-foreground"
              >
                Emerge Capital
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** The account control: sign in, or the person's first name as the way into their briefing. */
function Account() {
  const { user, loading } = useSession();
  const [asking, setAsking] = useState(false);
  if (!authEnabled || loading) return null;

  if (!user) {
    return (
      <>
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Sign in
        </button>
        {asking ? (
          <SignInDialog reason="to build your briefing" onClose={() => setAsking(false)} />
        ) : null}
      </>
    );
  }

  const name = (user.user_metadata?.["full_name"] as string | undefined)?.split(" ")[0];
  return (
    <Link
      to="/home"
      activeProps={{ className: "text-foreground" }}
      inactiveProps={{ className: "text-muted-foreground hover:text-foreground" }}
      title={user.email ?? undefined}
      className="transition-colors"
    >
      {name || "Your briefing"}
    </Link>
  );
}
