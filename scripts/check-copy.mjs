// Fails if the default claim-path copy uses words recipients should never see (Agent.md 11.3).
// Scans keys and values between the @claim-default markers in apps/web/src/copy.ts.
import { readFileSync } from "node:fs";

const FORBIDDEN = ["wallet", "seed", "blockchain", "zec", "shielded", "address", "crypto", "token", "transaction"];
const START = "// @claim-default:start";
const END = "// @claim-default:end";

const file = process.argv[2] ?? new URL("../apps/web/src/copy.ts", import.meta.url);
const source = readFileSync(file, "utf8");
const start = source.indexOf(START);
const end = source.indexOf(END);
if (start === -1 || end === -1 || end < start) {
  console.error(`check-copy: markers "${START}" / "${END}" not found in apps/web/src/copy.ts`);
  process.exit(1);
}

const lines = source.slice(start + START.length, end).split("\n");
const lineOffset = source.slice(0, start).split("\n").length;
const problems = [];
lines.forEach((line, i) => {
  // Split camelCase keys too, so `walletOption` is caught as "wallet".
  const words = line
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/);
  for (const bad of FORBIDDEN) {
    if ([bad, `${bad}s`, `${bad}es`].some((w) => words.includes(w))) problems.push(`  line ${lineOffset + i}: "${bad}" in: ${line.trim()}`);
  }
});

if (problems.length) {
  console.error(`check-copy: forbidden words on the default claim path:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`check-copy: ok (${lines.length} lines of default claim copy scanned)`);
