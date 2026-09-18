import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SIMULATION_VERSION, type MatchJournal } from "@zombie/game-core";
import { describe, expect, it } from "vitest";
import { verifyJournal } from "./verifier.js";

/**
 * Journals recorded by the real server (bots over sockets, `pnpm --filter @zombie/server
 * record-golden`) and committed. They replay exactly on this build or the build is a
 * simulation change: either bump `SIMULATION_VERSION` deliberately and re-record, or find
 * the accidental change (docs/DEVELOPMENT.md, "Version bump rules").
 */
const GOLDEN_DIR = join(import.meta.dirname, "../../fixtures/golden");

describe("golden journals", () => {
  const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".journal.json"));
  it("has at least one recorded journal", () => {
    expect(files.length).toBeGreaterThan(0);
  });
  it.each(files)("%s replays exactly on this build", (file) => {
    const journal = JSON.parse(readFileSync(join(GOLDEN_DIR, file), "utf8")) as MatchJournal;
    expect(
      journal.metadata.simulationVersion,
      `${file} was recorded by simulation version ${journal.metadata.simulationVersion}; this build is ${SIMULATION_VERSION}. ` +
        "If the bump was deliberate, re-record with `pnpm --filter @zombie/server record-golden`.",
    ).toBe(SIMULATION_VERSION);
    const verdict = verifyJournal(journal);
    expect(
      verdict,
      `${file} diverged: the rules changed without a SIMULATION_VERSION bump, or an accidental change slipped in.`,
    ).toMatchObject({ ok: true, entries: journal.entries.length });
  });
});
