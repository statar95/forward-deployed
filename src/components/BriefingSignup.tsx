import { useState } from "react";
import { joinBriefing, useJoined, type JoinResult } from "@/lib/briefing";

/**
 * The whole sign-up: an address, and nothing else.
 *
 * It used to ask for your industries too. docs/signup.md argued for that on the grounds that the
 * answer would sort your briefing. It does not: the Monday email is one email for everyone, because
 * a single industry yields one or two roles in a week (measured 21 Sep: 15 new roles, biggest
 * industry among them 2). So the question was taking a tap and giving nothing back, and a second
 * control next to an email field is the difference between reading a form and typing an address.
 * Ask later, in the email, where an answer can be one tap and can be acted on.
 */
export function BriefingSignup({
  heading = "The week's roles and signals, every Monday.",
  note,
  className = "",
}: {
  heading?: string;
  note?: string;
  className?: string;
}) {
  const joinedBefore = useJoined();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | JoinResult>("idle");

  const done = state === "joined" || state === "already";
  if (done || (joinedBefore && state === "idle")) {
    return (
      <div className={className}>
        <p className="font-display text-[26px] leading-[1.1] tracking-[-0.02em] sm:text-[30px]">
          {state === "already" ? "You were already on the list." : "You are on the list."}
        </p>
        <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">
          Check your inbox: there is a note there saying what to expect. The briefing itself lands
          on Monday morning. Reply to either and a person reads it.
        </p>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    setState(await joinBriefing(email));
  };

  return (
    <div className={className}>
      {heading ? (
        <p className="font-display max-w-[24ch] text-[26px] leading-[1.1] tracking-[-0.02em] sm:text-[30px]">
          {heading}
        </p>
      ) : null}
      {note ? (
        <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">
          {note}
        </p>
      ) : null}

      <form
        onSubmit={submit}
        className="mt-6 flex max-w-[520px] flex-wrap items-end gap-x-5 gap-y-4"
      >
        <label className="min-w-[240px] flex-1">
          <span className="sr-only">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (state !== "idle") setState("idle");
            }}
            autoComplete="email"
            placeholder="you@work.com"
            aria-label="Email"
            className="w-full border-b border-foreground bg-transparent pb-[7px] text-[18px] outline-none placeholder:text-muted-foreground/60 focus:border-primary"
          />
        </label>
        <button
          type="submit"
          disabled={state === "sending" || !email.trim()}
          className="tap inline-flex h-[40px] items-center border border-foreground px-6 text-[16px] transition-colors hover:bg-foreground hover:text-background disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-foreground"
        >
          {state === "sending" ? "Signing you up" : "Send it to me"}
        </button>
      </form>

      <p className="mt-4 text-[13px] text-muted-foreground">
        One email a week. Nothing else.{" "}
        <a href="/briefing" className="border-b border-foreground/30 hover:border-foreground hover:text-foreground">
          See the last issue
        </a>
        .
      </p>

      {state === "bad-email" ? (
        <p className="mt-4 text-[14px] text-primary">
          That address does not look right. Check it and send again.
        </p>
      ) : null}
      {state === "failed" ? (
        <p className="mt-4 text-[14px] text-primary">
          That did not save. Try once more, or write to hello@forwarddeployed.work and we will add
          you by hand.
        </p>
      ) : null}
    </div>
  );
}
