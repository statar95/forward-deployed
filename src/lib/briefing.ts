/**
 * Joining the Monday briefing. One email address, and nothing else.
 *
 * Deliberately not sign-in. Asking someone to leave the page, open their email and copy a six digit
 * code before they have seen anything is the wrong first ask.
 *
 * The list lives in Resend, not in a database of ours, because the only thing we do with it is send
 * one email a week, and Resend is already the thing that sends it. It also owns the unsubscribe,
 * which is the part that is embarrassing to get wrong. The browser posts to `api/subscribe.ts`,
 * which holds the key.
 */
import { useEffect, useState } from "react";

export const briefingConnected = true;

export type JoinResult = "joined" | "already" | "bad-email" | "failed";

const REMEMBER = "fd.briefing.email";
const REF = "fd.ref";

/**
 * Which outreach brought this reader, from `?ref=` on the link they arrived by (e.g. a lemlist
 * campaign links to /?ref=li-fde-note). Kept for the visit, because people click around before
 * they sign up and the tag is gone from the address bar by then. First tag wins.
 */
function captureRef(): string {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("ref") ?? "";
    const clean = fromUrl.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
    const kept = window.sessionStorage.getItem(REF);
    if (kept) return kept;
    if (clean) window.sessionStorage.setItem(REF, clean);
    return clean;
  } catch {
    return "";
  }
}

function signupSource(): string {
  if (typeof window === "undefined") return "";
  const ref = captureRef();
  return ref ? `${window.location.pathname} ref=${ref}` : window.location.pathname;
}

export async function joinBriefing(email: string): Promise<JoinResult> {
  const address = email.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return "bad-email";

  let outcome: JoinResult = "failed";
  try {
    const sent = await fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: address,
        source: signupSource(),
      }),
    });
    const said = (await sent.json().catch(() => ({}))) as { status?: string; error?: string };
    if (sent.ok) outcome = said.status === "already" ? "already" : "joined";
    else if (said.error === "bad_email") outcome = "bad-email";
  } catch {
    // Offline, or the request never left. "failed" tells them to try again, which is the truth.
  }

  if (outcome === "joined" || outcome === "already") remember(address);
  return outcome;
}

function remember(email: string) {
  try {
    window.localStorage.setItem(REMEMBER, email);
  } catch {
    // Private windows and blocked site data. The contact is saved either way; only the greeting is lost.
  }
}

/** The address this browser last joined with, so a returning reader is not asked twice. */
export function useJoined(): string | null {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    captureRef();
    try {
      setEmail(window.localStorage.getItem(REMEMBER));
    } catch {
      setEmail(null);
    }
  }, []);
  return email;
}
