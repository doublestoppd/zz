import { writeFileSync } from "node:fs";
import { formatTable } from "./measure.js";
import { runBenchmarks } from "./benchmarks.js";

/**
 * `pnpm --filter @zombie/server bench [-- --json out.json]`: runs every benchmark case on
 * deterministic fixtures and prints a markdown table (paste into docs/PERFORMANCE.md).
 * Numbers are wall-clock on this machine; budgets are derived from them with headroom.
 */
const rows = runBenchmarks();
process.stdout.write(`${formatTable(rows)}\n`);
const index = process.argv.indexOf("--json");
const out = index === -1 ? undefined : process.argv[index + 1];
if (out !== undefined) {
  writeFileSync(out, JSON.stringify({ node: process.version, rows }, null, 2));
  process.stdout.write(`written ${out}\n`);
}
