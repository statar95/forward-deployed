import { createFileRoute } from "@tanstack/react-router";
import { SiteFrame } from "@/components/SiteFrame";
import { BriefingSignup } from "@/components/BriefingSignup";
import { LivePulse } from "@/components/LivePulse";
import { useDataset } from "@/lib/roles";

export const Route = createFileRoute("/briefing")({
  head: () => ({
    meta: [
      { title: "The Monday briefing, and last week's issue" },
      {
        name: "description",
        content:
          "Who just raised and is about to build a deployment team, what they do, and the week's new forward deployed roles. See a real issue before you give anyone your address.",
      },
      { property: "og:title", content: "The Monday briefing" },
      {
        property: "og:description",
        content: "Read a real issue before you sign up. Funding first, roles second, one email a week.",
      },
    ],
  }),
  component: BriefingPage,
});

/**
 * The last issue, in full, before anyone is asked for an address.
 *
 * Asking someone to subscribe to a thing they cannot see is asking for trust nobody owes us, and the
 * one FDE who has looked at this said he would not sign up. The issue itself is the argument.
 *
 * It is the real email, the same file the builder produces, shown in an iframe rather than
 * reimplemented in the site's components. A second implementation would drift, and then the page
 * would be advertising something that is not what arrives.
 */
function BriefingPage() {
  const { data } = useDataset();

  return (
    <SiteFrame>
      <div className="mx-auto max-w-[1180px] px-6 sm:px-10">
        <div className="mt-12 flex flex-wrap items-baseline justify-between gap-4 sm:mt-16">
          <h1 className="font-display max-w-[20ch] text-[34px] leading-[1.05] tracking-[-0.02em] sm:text-[48px]">
            One email, every Monday.
          </h1>
          <LivePulse generated={data?.generated} />
        </div>

        <p className="mt-5 max-w-[58ch] text-[16px] leading-relaxed text-muted-foreground">
          Who just raised and is about to build a deployment team, what each of them actually does, and
          the week's new roles. Ordered by who needs people on the ground, not by who raised most. Here
          is the last issue in full, so you can decide before giving anyone your address.
        </p>

        <div className="mt-9">
          <BriefingSignup heading="" />
        </div>

        <div className="mt-12 border-t border-hairline pt-8">
          <p className="text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
            Last issue, exactly as it arrives
          </p>
          <div className="mt-4 overflow-hidden border border-hairline bg-white">
            <iframe
              src="/briefing/latest.html"
              title="The most recent Forward Deployed briefing"
              loading="lazy"
              className="h-[900px] w-full"
            />
          </div>
          <p className="mt-3 text-[13px] text-muted-foreground">
            <a
              href="/briefing/latest.html"
              target="_blank"
              rel="noopener noreferrer"
              className="border-b border-foreground/30 hover:border-foreground hover:text-foreground"
            >
              Open it in its own tab
            </a>
          </p>
        </div>
      </div>
    </SiteFrame>
  );
}
