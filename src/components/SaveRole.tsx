import { useState } from "react";
import { authEnabled, useSavedRoles } from "@/lib/auth";
import { SignInDialog } from "@/components/SignInDialog";
import type { Role } from "@/lib/roles";

/** Save a role to the briefing. Asks for sign-in at the click, never before. */
export function SaveRole({ role }: { role: Role }) {
  const { isSaved, toggle, signedIn, loading } = useSavedRoles();
  const [asking, setAsking] = useState(false);
  if (!authEnabled) return null;

  const saved = isSaved(role.id);
  return (
    <>
      <button
        type="button"
        disabled={loading}
        onClick={() => {
          if (!signedIn) {
            setAsking(true);
            return;
          }
          void toggle({ id: role.id, company: role.company, title: role.title });
        }}
        aria-pressed={saved}
        className="border-b border-foreground pb-[2px] text-[16px] hover:border-primary hover:text-primary"
      >
        {saved ? "Saved" : "Save"}
      </button>
      {asking ? (
        <SignInDialog
          reason="so this role is on your briefing next week"
          onClose={() => setAsking(false)}
          onSignedIn={() => void toggle({ id: role.id, company: role.company, title: role.title })}
        />
      ) : null}
    </>
  );
}
