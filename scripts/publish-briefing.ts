/**
 * Put the current briefing on the site as the public example issue.
 *
 *   npm run briefing:publish
 *
 * Someone deciding whether to subscribe should be able to read an issue first. This writes the real
 * email, the same builder the broadcast uses, to public/briefing/latest.html, and resolves the one
 * Resend merge tag that only means anything inside a broadcast.
 *
 * Run it after a refresh when the issue is worth showing. It is deliberately a command rather than
 * part of the two-hourly scrape: the example issue should be a good one, not whatever the last run
 * happened to produce.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { buildBriefing, type Dataset } from "../lib/briefing.js";

const OUT = "public/briefing/latest.html";

const data = JSON.parse(readFileSync("public/data/roles.json", "utf8")) as Dataset;
const b = buildBriefing(data, new Date(), 7, {});

// {{{RESEND_UNSUBSCRIBE_URL}}} is substituted by Resend on a real send. On a web page it would show
// up literally, so the public copy says what the link is instead of pretending to be one.
const html = b.html
  .replace(/href="\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}"/g, 'href="#"')
  .replace(/\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}/g, "one click, on every issue");

mkdirSync("public/briefing", { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
console.log(`  ${b.subject}`);
console.log(`  ${b.counts.roles} roles, ${b.counts.raised} raised, ${b.counts.building} building`);
