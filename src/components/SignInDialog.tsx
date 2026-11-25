import { useEffect, useRef, useState } from "react";
import { sendSignInCode, verifySignInCode } from "@/lib/auth";

/**
 * Sign in with an email address and the six digit code that follows. No password to invent, no Google
 * account required, and nothing to install. The dialog closes itself once the session exists.
 */
export function SignInDialog({
  onClose,
  onSignedIn,
  reason,
}: {
  onClose: () => void;
  onSignedIn?: () => void;
  /** One line saying why we are asking, e.g. "to save this role". */
  reason?: string;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    field.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, stage]);

  const send = async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError("That does not look like an email address.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await sendSignInCode(email);
    setBusy(false);
    if (error) {
      setError(
        error.message.toLowerCase().includes("rate")
          ? "Too many codes requested. Wait a minute and try again."
          : "The code could not be sent. Try again in a moment.",
      );
      return;
    }
    setStage("code");
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    const { error } = await verifySignInCode(email, code);
    setBusy(false);
    if (error) {
      setError("That code did not work. Check it, or send a new one.");
      return;
    }
    onSignedIn?.();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sign in"
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/25 p-4 backdrop-blur-[2px] sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-[420px] border border-hairline bg-background p-7">
        <h2 className="font-display text-[26px] leading-[1.1] tracking-[-0.02em]">
          {stage === "email" ? "Sign in" : "Check your email"}
        </h2>
        <p className="mt-3 max-w-[40ch] text-[14px] leading-relaxed text-muted-foreground">
          {stage === "email"
            ? `We send a six digit code${reason ? ` ${reason}` : ""}. No password, and we never post anything anywhere.`
            : `We sent a code to ${email}. It expires in an hour.`}
        </p>

        <div className="mt-6">
          {stage === "email" ? (
            <input
              ref={field}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && void send()}
              placeholder="you@company.com"
              aria-label="Email address"
              className="w-full border-b border-hairline bg-transparent pb-2 text-[16px] outline-none placeholder:text-muted-foreground/60 focus:border-foreground"
            />
          ) : (
            <input
              ref={field}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 8))}
              onKeyDown={(e) => e.key === "Enter" && !busy && void verify()}
              placeholder="123456"
              aria-label="Six digit code"
              className="w-full border-b border-hairline bg-transparent pb-2 text-[22px] tracking-[0.3em] outline-none placeholder:text-muted-foreground/40 focus:border-foreground"
            />
          )}
        </div>

        {error ? <p className="mt-3 text-[13px] text-[var(--signal)]">{error}</p> : null}

        <div className="mt-7 flex flex-wrap items-center gap-x-7 gap-y-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void (stage === "email" ? send() : verify())}
            className="tap inline-flex items-center border border-foreground px-6 text-[15px] transition-colors hover:bg-foreground hover:text-background disabled:opacity-50"
          >
            {busy ? "One moment" : stage === "email" ? "Send me a code" : "Sign in"}
          </button>
          {stage === "code" ? (
            <button
              type="button"
              onClick={() => {
                setStage("email");
                setCode("");
                setError(null);
              }}
              className="text-[14px] text-muted-foreground hover:text-foreground"
            >
              Use a different email
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-[14px] text-muted-foreground hover:text-foreground"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
