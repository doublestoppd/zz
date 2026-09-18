import { runSoak } from "./runSoak.js";
import { setLogLevel } from "../log.js";

/**
 * `pnpm --filter @zombie/server soak -- [--matches N] [--seed S] [--players P] [--chaos]
 * [--max-rounds R] [--failures DIR] [--journals DIR]`: plays N seeded matches with bots over real sockets and
 * exits 1 when any fails. Failing seeds are written to DIR (default `soak-failures/`) as a
 * replayable journal plus a `.failure.json` naming the invariant and the rerun command.
 */
function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}
function numberFlag(name: string, fallback: number): number {
  const raw = flag(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    process.stderr.write(`--${name} must be a non-negative integer\n`);
    process.exit(2);
  }
  return value;
}

if (process.env.LOG_LEVEL === undefined) setLogLevel("warn");
const playersFlag = flag("players");
const journalsFlag = flag("journals");
const report = await runSoak({
  matches: numberFlag("matches", 50),
  seedStart: numberFlag("seed", 1),
  ...(playersFlag === undefined ? {} : { players: numberFlag("players", 4) }),
  chaos: process.argv.includes("--chaos"),
  maxRounds: numberFlag("max-rounds", 150),
  failuresDir: flag("failures") ?? process.env.SOAK_FAILURES_DIR ?? "soak-failures",
  ...(journalsFlag === undefined ? {} : { journalsDir: journalsFlag }),
  log: (line) => {
    process.stdout.write(`${line}\n`);
  },
});
const byOutcome = { victory: 0, defeat: 0, failure: 0 };
for (const r of report.results) byOutcome[r.outcome] += 1;
process.stdout.write(
  `${JSON.stringify({
    matches: report.results.length,
    ...byOutcome,
    commands: report.results.reduce((n, r) => n + r.commands, 0),
    reconnects: report.results.reduce((n, r) => n + r.reconnects, 0),
    probes: report.results.reduce((n, r) => n + r.probes, 0),
    durationMs: report.durationMs,
    failures: report.failures.map((f) => ({ seed: f.seed, players: f.players, ...f.failure })),
  })}\n`,
);
process.exit(report.failures.length === 0 ? 0 : 1);
