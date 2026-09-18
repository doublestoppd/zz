import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MatchJournal } from "@zombie/game-core";
import { describe, expect, it } from "vitest";
import { verifyJournal } from "../replay/verifier.js";
import { runSoak } from "./runSoak.js";

describe("soak (bots over real sockets)", () => {
  it("plays 1 to 4 player matches to the end with chaos on and no invariant failures", async () => {
    const report = await runSoak({
      matches: 8,
      seedStart: 101,
      chaos: true,
      maxRounds: 150,
    });
    const summary = report.results.map(
      (r) =>
        `${r.players}p seed ${r.seed}: ${r.outcome} rounds=${r.rounds} commands=${r.commands} reconnects=${r.reconnects} probes=${r.probes}`,
    );
    expect(
      report.failures.map((f) => f.failure),
      summary.join("\n"),
    ).toEqual([]);
    expect(report.results.map((r) => r.players)).toEqual([1, 2, 3, 4, 1, 2, 3, 4]);
    // The chaos actually happened: sockets were dropped and probes were classified.
    expect(report.results.reduce((n, r) => n + r.reconnects, 0)).toBeGreaterThan(0);
    expect(report.results.reduce((n, r) => n + r.probes, 0)).toBeGreaterThan(0);
  }, 60_000);

  it("writes a replayable journal and the rerun recipe when a match fails an invariant", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zombie-soak-"));
    const report = await runSoak({
      matches: 1,
      seedStart: 7,
      players: 2,
      chaos: false,
      maxRounds: 150,
      failuresDir: dir,
      // A deliberately wrong invariant: fires on the first snapshot after round 1.
      invariants: (state) => (state.round >= 2 ? ["round 2 reached (test invariant)"] : []),
    });
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.failure).toMatchObject({
      reason: "INVARIANT",
      detail: "round 2 reached (test invariant)",
      journalFile: join(dir, "7-2p.journal.json"),
    });
    expect(readdirSync(dir).sort()).toEqual(["7-2p.failure.json", "7-2p.journal.json"]);
    const failure = JSON.parse(readFileSync(join(dir, "7-2p.failure.json"), "utf8")) as {
      rerun: string;
      seed: number;
    };
    expect(failure.seed).toBe(7);
    expect(failure.rerun).toContain("--seed 7");
    const journal = JSON.parse(
      readFileSync(join(dir, "7-2p.journal.json"), "utf8"),
    ) as MatchJournal;
    expect(journal.metadata.seed).toBe(7);
    expect(verifyJournal(journal)).toMatchObject({ ok: true });
  }, 30_000);
});
