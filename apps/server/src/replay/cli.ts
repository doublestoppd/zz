import { readFileSync } from "node:fs";
import type { MatchJournal } from "@zombie/game-core";
import { verifyJournal } from "./verifier.js";

/**
 * `pnpm --filter @zombie/server replay <journal.json>`: re-simulates a recorded match with
 * this build and prints the verdict as one JSON line. Exit code 0 when the replay matches,
 * 1 when it diverges or the simulation version is unsupported, 2 when the file is unusable.
 */
const file = process.argv[2];
if (file === undefined) {
  process.stderr.write("usage: replay <journal.json>\n");
  process.exit(2);
}
let journal: MatchJournal;
try {
  journal = JSON.parse(readFileSync(file, "utf8")) as MatchJournal;
} catch (error) {
  process.stderr.write(`cannot read journal: ${String(error)}\n`);
  process.exit(2);
}
const verdict = verifyJournal(journal);
process.stdout.write(
  `${JSON.stringify({ matchId: journal.metadata.matchId, seed: journal.metadata.seed, ...verdict })}\n`,
);
process.exit(verdict.ok ? 0 : 1);
