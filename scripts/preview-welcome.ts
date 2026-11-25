/**
 * Render the welcome note to a file so the copy can be read before anyone is sent it.
 *
 *   npm run welcome:preview
 *
 * Same builder the endpoint uses, so the preview and the real send cannot drift.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { buildWelcome } from "../lib/welcome.js";
import type { Dataset } from "../lib/briefing.js";

const data = JSON.parse(readFileSync("public/data/roles.json", "utf8")) as Dataset;
const mail = buildWelcome(data);
mkdirSync("out", { recursive: true });
writeFileSync("out/welcome.html", mail.html);
writeFileSync("out/welcome.txt", `${mail.subject}\n\n${mail.text}`);
console.log(`subject: ${mail.subject}`);
console.log("wrote out/welcome.html and out/welcome.txt");
