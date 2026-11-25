import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { SiteFrame } from "@/components/SiteFrame";
import { Onboarding } from "@/components/Onboarding";
import { authEnabled, signOut, useCandidate } from "@/lib/auth";
import { useDataset } from "@/lib/roles";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Your answers" },
      { name: "description", content: "The four answers that decide what lands on your briefing." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProfilePage,
});

/** The four answers again, plus the two things that are nobody's business but the candidate's. */
function ProfilePage() {
  const { candidate, loading, save } = useCandidate();
  const { data } = useDataset();
  const [saved, setSaved] = useState(false);

  if (!authEnabled || loading) {
    return (
      <SiteFrame>
        <p className="mx-auto max-w-[1180px] px-6 py-16 text-[14px] text-muted-foreground sm:px-10">
          Loading
        </p>
      </SiteFrame>
    );
  }

  if (!candidate) {
    return (
      <SiteFrame>
        <div className="mx-auto max-w-[1180px] px-6 py-16 sm:px-10">
          <h1 className="font-display text-[32px] leading-[1.05] tracking-[-0.02em]">
            Sign in first
          </h1>
          <Link
            to="/home"
            className="mt-6 inline-block border-b border-foreground pb-[2px] text-[15px] hover:border-primary hover:text-primary"
          >
            Go to your briefing
          </Link>
        </div>
      </SiteFrame>
    );
  }

  return (
    <SiteFrame>
      {data ? (
        <Onboarding
          data={data}
          candidate={candidate}
          onDone={(patch) => {
            setSaved(true);
            void save(patch);
          }}
          submitLabel="Save answers"
        />
      ) : null}
      <div className="mx-auto max-w-[760px] px-6 pb-20 sm:px-10">
        <section className="border-t border-hairline pt-8">
          <h2 className="text-[17px]">Email and privacy</h2>
          <label className="mt-5 flex cursor-pointer items-baseline gap-3 text-[15px] text-muted-foreground">
            <input
              type="checkbox"
              checked={candidate.digest}
              onChange={(e) => {
                setSaved(true);
                void save({ digest: e.target.checked });
              }}
              className="h-[14px] w-[14px] accent-[var(--signal)]"
            />
            <span>Email me my briefing on Mondays</span>
          </label>
          <label className="mt-4 flex cursor-pointer items-baseline gap-3 text-[15px] text-muted-foreground">
            <input
              type="checkbox"
              checked={candidate.consent_employers}
              onChange={(e) => {
                setSaved(true);
                void save({ consent_employers: e.target.checked });
              }}
              className="h-[14px] w-[14px] accent-[var(--signal)]"
            />
            <span>
              Hiring teams can see my industries and years, not my name, until I say yes to an intro
            </span>
          </label>
          <div className="mt-6">
            <label className="block text-[13px] text-muted-foreground" htmlFor="linkedin">
              LinkedIn, used only when you ask us for a route in
            </label>
            <input
              id="linkedin"
              type="url"
              defaultValue={candidate.linkedin_url ?? ""}
              onBlur={(e) => {
                setSaved(true);
                void save({ linkedin_url: e.target.value.trim() || null });
              }}
              placeholder="https://www.linkedin.com/in/…"
              className="mt-2 w-full max-w-[420px] border-b border-hairline bg-transparent pb-1 text-[15px] outline-none placeholder:text-muted-foreground/60 focus:border-foreground"
            />
          </div>
          {saved ? <p className="mt-5 text-[13px] text-[var(--signal)]">Saved.</p> : null}
        </section>

        <section className="mt-10 border-t border-hairline pt-8">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <button
              type="button"
              onClick={() => void signOut()}
              className="text-[15px] text-muted-foreground hover:text-foreground"
            >
              Sign out
            </button>
            <span className="text-[13px] text-muted-foreground/80">
              Signed in as {candidate.email ?? "your email"}
            </span>
          </div>
        </section>
      </div>
    </SiteFrame>
  );
}
