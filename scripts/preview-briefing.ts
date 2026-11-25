/**
 * Render Monday's briefing to a file so it can be read before anyone is sent it.
 *
 *   npx tsx scripts/preview-briefing.ts [--days 7] [--out out/briefing.html]
 *
 * Same builder the endpoint uses, so the preview and the real broadcast cannot drift.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { buildBriefing, type Dataset } from "../lib/briefing.js";
import { MANAGERS } from "../lib/hiring-managers.js";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
};

const data = JSON.parse(readFileSync("public/data/roles.json", "utf8")) as Dataset;
const b = buildBriefing(data, new Date(), Number(arg("days", "7")), MANAGERS);
const out = arg("out", "out/briefing.html");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, b.html);
writeFileSync(out.replace(/\.html$/, ".txt"), `${b.subject}\n\n${b.text}`);
console.log(`subject: ${b.subject}`);
console.log(`preheader: ${b.preheader}`);
console.log(`counts: ${b.counts.roles} roles, ${b.counts.raised} raised, ${b.counts.building} building`);
console.log(`wrote ${out} and its .txt twin`);
