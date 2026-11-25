/**
 * Send the rendered briefing to one named address, for review.
 *
 *   npx tsx scripts/send-briefing-test.ts you@example.com
 *
 * Deliberately NOT a broadcast. Resend's broadcast endpoint sends to an audience, and the audience is
 * the real subscriber list: one wrong call there mails everybody. This uses the transactional endpoint
 * with an explicit `to`, so the worst case is one person gets one email, and it refuses to start
 * unless exactly one address is given.
 *
 * The key is read from the Keychain at the moment it is used and never written anywhere, which is the
 * house rule for every local key (see the MCP auth convention).
 */
import { execFileSync } from "node:child_process";
import { buildBriefing, type Dataset } from "../lib/briefing.js";
import { MANAGERS } from "../lib/hiring-managers.js";

const SITE = "https://forwarddeployed.work";
const FROM = '"Forward Deployed" <briefing@send.forwarddeployed.work>';
const REPLY_TO = "hello@forwarddeployed.work";

/**
 * The key, from the environment or the Keychain. Never from a file, and never asked for in chat.
 * `security` exits 44 when the item is missing, which is easy to swallow: checking this with
 * `security ... | head -c 6 && echo found` reports success on empty output, because the pipeline's
 * status is head's.
 */
function apiKey(): string {
  const fromEnv = process.env["RESEND_API_KEY"];
  if (fromEnv) return fromEnv.trim();
  try {
    const out = execFileSync("security", ["find-generic-password", "-s", "RESEND_API_KEY", "-w"], {
      encoding: "utf8",
    }).trim();
    if (out) return out;
  } catch {
    // fall through to the message below
  }
  throw new Error(
    "No RESEND_API_KEY. Either put it in the Keychain once:\n" +
      "  security add-generic-password -s RESEND_API_KEY -a $USER -w '<key>'\n" +
      "or pass it for this run only:\n" +
      "  RESEND_API_KEY='<key>' npx tsx scripts/send-briefing-test.ts <address>",
  );
}

async function main() {
  const to = process.argv.slice(2).filter(Boolean);
  if (to.length !== 1) {
    console.error("give exactly one address. This is a review send, not a broadcast.");
    process.exit(2);
  }
  const address = to[0]!;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
    console.error(`that does not look like an address: ${address}`);
    process.exit(2);
  }

  const data = (await fetch(`${SITE}/data/roles.json`, { cache: "no-store" }).then((r) =>
    r.json(),
  )) as Dataset;
  const briefing = buildBriefing(data, new Date(), 7, MANAGERS);

  const key = apiKey();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [address], // one address, named on the command line. Never an audience.
      reply_to: REPLY_TO,
      subject: `[review] ${briefing.subject}`,
      html: briefing.html,
      text: briefing.text,
    }),
  });

  const body = (await res.json()) as { id?: string; message?: string };
  if (!res.ok) {
    console.error(`Resend refused it: ${res.status} ${body.message ?? ""}`);
    process.exit(1);
  }
  console.log(`sent to ${address}`);
  console.log(`  subject: ${briefing.subject}`);
  console.log(`  ${briefing.counts.roles} roles, ${briefing.counts.raised} raised, ${briefing.counts.building} building`);
  console.log(`  resend id: ${body.id}`);
}

void main();
