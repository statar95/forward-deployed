/**
 * Who is on the briefing list, and what the Monday cron has produced.
 *
 *   npx tsx scripts/check-list.ts
 *
 * The list lives only in Resend, which was the deliberate choice: one place a person exists and one
 * place they leave from. That means checking it needs the Resend key, and the key is a Vercel secret.
 *
 * It is pulled from Vercel into a file **outside the repo**, read, and the file deleted in the same
 * breath. Outside matters: `.env` is not in this repo's .gitignore and Lovable commits one, so a key
 * pulled into the working directory is a key one `git add -A` away from being published.
 *
 * Nothing here prints the key, and nothing here sends anything.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOPIC = "Forward Deployed weekly briefing";

function resendKey(): string {
  const fromEnv = process.env["RESEND_API_KEY"];
  if (fromEnv) return fromEnv.trim();

  const dir = mkdtempSync(join(tmpdir(), "fde-env-"));
  const file = join(dir, "pulled");
  try {
    execFileSync("npx", ["vercel", "env", "pull", file, "--environment=development", "--yes"], {
      stdio: "ignore",
    });
    const line = readFileSync(file, "utf8")
      .split("\n")
      .find((l) => l.startsWith("RESEND_API_KEY="));
    if (!line) throw new Error("RESEND_API_KEY is not in the pulled environment");
    return line.slice("RESEND_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function get(path: string, key: string) {
  const res = await fetch(`https://api.resend.com${path}`, {
    headers: { authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as { data?: unknown[] };
}

async function main() {
  const key = resendKey();

  const contacts = ((await get("/contacts", key)).data ?? []) as {
    email: string;
    unsubscribed: boolean;
    created_at: string;
  }[];
  const live = contacts.filter((c) => !c.unsubscribed);
  console.log(`SUBSCRIBERS: ${live.length} (${contacts.length - live.length} unsubscribed)`);
  for (const c of contacts) {
    console.log(
      `  ${c.email.padEnd(38)} ${c.unsubscribed ? "unsubscribed" : "subscribed  "} since ${c.created_at.slice(0, 10)}`,
    );
  }

  const broadcasts = ((await get("/broadcasts", key)).data ?? []) as {
    name: string;
    status: string;
    created_at: string;
    sent_at: string | null;
  }[];
  const sent = broadcasts.filter((b) => b.sent_at);
  console.log(`\nBRIEFINGS: ${broadcasts.length} built, ${sent.length} sent`);
  for (const b of broadcasts) {
    console.log(
      `  ${b.created_at.slice(0, 16)}  ${b.status.padEnd(9)} ${b.sent_at ? `sent ${b.sent_at.slice(0, 10)}` : "never sent"}  ${b.name}`,
    );
  }

  if (broadcasts.length && !sent.length) {
    console.log(`\nEvery briefing so far is a draft. The cron builds them; a person presses send.`);
  }
  if (!live.length) {
    console.log(`Nobody is on the "${TOPIC}" list, so sending today would reach nobody.`);
  }
}

void main();
