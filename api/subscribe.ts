/**
 * Join the Monday briefing.
 *
 * The browser cannot talk to Resend directly, because that needs a secret key, so this is the one
 * piece of server the board has. It lives in `api/` rather than in the app because the app's Vite
 * config is a vendor package we do not edit; Vercel picks up `api/` whatever the framework is.
 *
 * It holds no list of its own. Resend is the list: the contact, an opt-in to the briefing topic,
 * which is what gives them a real unsubscribe later, and membership of the segment the briefing is
 * sent to, without which they never receive it (lib/segment.ts). It also sends the note that says what they just
 * signed up for, which is why it has to know whether this address is new.
 */
import { buildWelcome } from "../lib/welcome.js";
import { briefingSegmentId, enrol } from "../lib/segment.js";
import type { Dataset } from "../lib/briefing.js";

const TOPIC_ID = "d44891af-e24e-4a11-ab33-78af23b431eb"; // Forward Deployed weekly briefing
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// The display name is quoted. Unquoted it arrived in the inbox as just "Forward", because a bare
// space ends the phrase and the rest is discarded.
const FROM = '"Forward Deployed" <briefing@send.forwarddeployed.work>';
const REPLY_TO = "hello@forwarddeployed.work";
const SITE = "https://forwarddeployed.work";

type Req = {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
};
type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const key = process.env["RESEND_API_KEY"];
  if (!key) {
    // Loud rather than silent: a missing key must not look like a successful sign-up.
    console.error("RESEND_API_KEY is not set");
    res.status(500).json({ error: "not_configured" });
    return;
  }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as
    { email?: unknown; source?: unknown } | undefined;

  // Lower case, because Resend keys contacts on the exact string: Jo@ and jo@ became two
  // contacts in testing, which is one person getting the briefing twice.
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) {
    res.status(400).json({ error: "bad_email" });
    return;
  }

  const source = typeof body?.source === "string" ? body.source.slice(0, 80) : "";

  // Ask first, because Resend updates an existing contact rather than refusing it, so a create
  // alone cannot tell a new subscriber from someone pressing the button twice. Without this the
  // welcome note would arrive again every time, which is the one email nobody wants twice.
  const already = await fetch(`https://api.resend.com/contacts/${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  // The briefing sends to a segment, and a contact is only in one if we put it there. Looked up
  // before the create so the contact lands in it in the same call. If the lookup fails the sign-up
  // still goes through: the briefing enrols anyone missing before it sends.
  const segmentId = await briefingSegmentId(key);
  if (already.ok) {
    // Signed up before 26 Oct, when nothing enrolled anyone, so make sure they are in it now.
    if (segmentId) await enrol(key, email, segmentId);
    res.status(200).json({ status: "already" });
    return;
  }

  const sent = await fetch("https://api.resend.com/contacts", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      unsubscribed: false,
      properties: { ...(source ? { signup_source: source } : {}) },
      topics: [{ id: TOPIC_ID, subscription: "opt_in" }],
      ...(segmentId ? { segments: [{ id: segmentId }] } : {}),
    }),
  });

  if (sent.ok) {
    await sendWelcome(key, email);
    res.status(201).json({ status: "joined" });
    return;
  }

  // A repeat address is a success from where the reader sits, so say so rather than showing an error.
  const detail = await sent.text();
  if (sent.status === 409 || /already|exists|duplicate/i.test(detail)) {
    res.status(200).json({ status: "already" });
    return;
  }

  console.error("resend contact create failed", sent.status, detail.slice(0, 500));
  res.status(502).json({ error: "upstream" });
}

/**
 * The note that says what they just signed up for. A failure here must not fail the sign-up: they
 * are on the list either way, and telling them otherwise would be a lie that loses the address.
 */
async function sendWelcome(key: string, to: string) {
  try {
    const data = (await fetch(`${SITE}/data/roles.json`, {
      signal: AbortSignal.timeout(3000),
    }).then((r) => (r.ok ? r.json() : null))) as Dataset | null;
    const mail = buildWelcome(data);
    const out = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to,
        reply_to: REPLY_TO,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
    });
    if (!out.ok) console.error("welcome send failed", out.status, (await out.text()).slice(0, 300));
  } catch (err) {
    console.error("welcome send threw", String(err).slice(0, 300));
  }
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
