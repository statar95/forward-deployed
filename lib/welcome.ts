/**
 * The note that arrives the moment someone signs up.
 *
 * The copy is reproduced as written. Do not tidy it: the
 * sign-off is a joke and the joke is the point.
 *
 * The one sentence that is not fixed is the count, which is read off the live board rather than
 * typed into the copy, because a welcome email claiming "355 roles" a year from now is a small lie
 * told at the first contact. If the board cannot be read, that sentence is dropped rather than
 * guessed at.
 */
import type { Dataset } from "./briefing.js";

const SITE = "https://forwarddeployed.work";
const MARK = `${SITE}/apple-touch-icon.png`;
const INK = "#13161a";
const MUTED = "#65696f";
const HAIRLINE = "#ecebe8";
const PAPER = "#fbfaf8";

/**
 * The landing page sets its wordmark in Instrument Serif. Apple Mail and Outlook for Mac will fetch
 * it, Gmail strips the stylesheet and falls back to Georgia, which is the closest thing already on
 * the machine. Both look deliberate, which is the most an email can ask for.
 */
const DISPLAY = "'Instrument Serif', Georgia, 'Times New Roman', serif";
const BODY = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export type Welcome = { subject: string; html: string; text: string };

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** What the board holds right now, or null when it could not be read. */
export function boardShape(data: Dataset | null) {
  if (!data?.roles?.length) return null;
  const core = data.roles.filter((r) => r.relevance === "core");
  const today = Date.now();
  const lastWeek = core.filter((r) => {
    if (!r.postedAt) return false;
    const posted = Date.parse(r.postedAt.slice(0, 10));
    return !Number.isNaN(posted) && (today - posted) / 86_400_000 <= 7;
  }).length;
  return { roles: core.length, boards: data.companies.length, lastWeek };
}

export function buildWelcome(data: Dataset | null): Welcome {
  const shape = boardShape(data);

  const lines = [
    "Every Monday morning you get an email with all the deployment roles posted in the last seven days. In addition, we'll also show you the companies that have just raised, and therefore likely to be building out deployment teams imminently.",
    shape
      ? `Right now that is ${shape.roles} live roles across ${shape.boards} companies, and ${shape.lastWeek} of them were posted in the last seven days.`
      : "",
    "If you reply, a person reads it. Tell me what you are looking for and I will keep an eye out.",
  ].filter(Boolean);

  const para = (t: string) =>
    `<p style="margin:0 0 18px 0;font:400 16px/1.65 ${BODY};color:${INK}">${esc(t)}</p>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>You're on the list</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif&display=swap">
</head>
<body style="margin:0;padding:0;background:${PAPER}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">One email a week. Here is what is in it.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}">
<tr><td align="center" style="padding:36px 20px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">

  <tr><td style="padding:0 0 26px 0">
    <a href="${SITE}" style="text-decoration:none;color:${INK}">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:10px;vertical-align:middle">
          <img src="${MARK}" width="26" height="26" alt="" style="display:block;width:26px;height:26px;border:0;border-radius:50%">
        </td>
        <td style="vertical-align:middle">
          <span style="font:400 22px/1 ${DISPLAY};letter-spacing:-0.01em;color:${INK}">Forward Deployed</span>
        </td>
      </tr></table>
    </a>
  </td></tr>

  <tr><td style="padding:0 0 20px 0">
    <div style="font:400 32px/1.15 ${DISPLAY};color:${INK}">You're on the list.</div>
  </td></tr>

  <tr><td>${lines.map(para).join("")}</td></tr>

  <tr><td style="padding:14px 0 0 0">
    <div style="font:400 16px/1.65 ${BODY};color:${INK}">xoxo,<br>Gossip Girl</div>
    <div style="font:400 14px/1.6 ${BODY};color:${MUTED};padding-top:10px">(Joke, I wish i looked like Dan Humphrey)</div>
  </td></tr>

  <tr><td style="padding:32px 0 0 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid ${HAIRLINE};padding-top:18px">
      <div style="font:400 14px/1.7 ${BODY};color:${MUTED}">
        <a href="${SITE}/roles" style="color:${INK}">See every live role</a>
        &nbsp;&middot;&nbsp;
        <a href="${SITE}/future" style="color:${INK}">Who is about to hire</a>
      </div>
      <div style="font:400 13px/1.6 ${BODY};color:${MUTED};padding-top:12px">
        You are getting this because you asked for the briefing on forwarddeployed.work. One email a
        week. <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:${MUTED}">Unsubscribe</a>.
      </div>
    </td></tr></table>
  </td></tr>

</table></td></tr></table></body></html>`;

  const text = [
    "FORWARD DEPLOYED",
    SITE,
    "",
    "You're on the list.",
    "",
    ...lines.flatMap((l) => [l, ""]),
    "xoxo,",
    "Gossip Girl",
    "",
    "(Joke, I wish i looked like Dan Humphrey)",
    "",
    "---",
    `Every live role: ${SITE}/roles`,
    `Who is about to hire: ${SITE}/future`,
    "",
    "You are getting this because you asked for the briefing on forwarddeployed.work.",
    "One email a week. Unsubscribe: {{{RESEND_UNSUBSCRIBE_URL}}}",
  ].join("\n");

  return { subject: "You're on the list", html, text };
}
