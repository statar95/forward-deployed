import { useState } from "react";
import { authEnabled, recordApply, useSession } from "@/lib/auth";
import { SignInDialog } from "@/components/SignInDialog";
import type { Role } from "@/lib/roles";

/**
 * The one place the board asks for anything.
 *
 * The list stays open: anyone can read every role, every company and every location. Signing in is
 * asked for at the moment someone acts on a role, which is the moment it is worth something to them
 * and to us. When sign in is not configured the gate does not exist and the link is an ordinary link,
 * because a gate nobody can pass is worse than no gate.
 */
export function ApplyLink({ role, className = "" }: { role: Role; className?: string }) {
  const { user, loading } = useSession();
  const [asking, setAsking] = useState(false);

  const open = !authEnabled || Boolean(user);

  if (open) {
    return (
      <a
        href={role.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => void recordApply(role.id, role.company, role.title)}
        className={className}
      >
        Apply at {role.company}
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={loading}
        onClick={() => setAsking(true)}
        className={className}
      >
        Apply at {role.company}
      </button>
      {asking ? (
        <SignInDialog
          reason="so we can keep the roles you apply to"
          onClose={() => setAsking(false)}
          onSignedIn={() => {
            void recordApply(role.id, role.company, role.title);
            window.open(role.url, "_blank", "noopener,noreferrer");
          }}
        />
      ) : null}
    </>
  );
}
