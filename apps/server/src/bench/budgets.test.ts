import {
  advanceUntilPlayerInput,
  checkInvariants,
  fingerprint,
  type GameState,
} from "@zombie/game-core";
import { encodeMessage } from "@zombie/protocol";
import { DEFAULT_CITY_OPTIONS, generateCity } from "@zombie/map-generation";
import { describe, expect, it } from "vitest";
import { MatchRuntime } from "../match/MatchRuntime.js";
import { redactState } from "../match/redact.js";
import { BUDGETS } from "./budgets.js";
import { buildFixtures, endTurnCommand, LARGE_CITY } from "./fixtures.js";
import { measure } from "./measure.js";

/**
 * Regression tripwires, not precise measurements: each case must stay under its budget
 * (docs/PERFORMANCE.md) by median over a handful of runs. Sizes are exact; times carry
 * an order of magnitude of headroom over the recorded medians.
 */
describe("performance budgets", () => {
  const fixtures = buildFixtures();
  const quick = { iterations: 10, warmup: 2, budgetMs: 3000 };
  const atRoundEnd = (state: GameState): GameState => ({
    ...state,
    phase: { kind: "zombie_phase" },
  });

  it("ends a round on the worst credible population within budget", () => {
    const heavy = measure(
      "heavy",
      () => advanceUntilPlayerInput(atRoundEnd(fixtures.heavy.state)),
      quick,
    );
    const noisy = measure(
      "noisy",
      () => advanceUntilPlayerInput(atRoundEnd(fixtures.noisy.state)),
      quick,
    );
    const large = measure(
      "large",
      () => advanceUntilPlayerInput(atRoundEnd(fixtures.large.state)),
      quick,
    );
    expect(heavy.medianMs, `heavy end of round ${heavy.medianMs.toFixed(2)}ms`).toBeLessThan(
      BUDGETS.endOfRoundHeavyMs,
    );
    expect(noisy.medianMs, `noisy end of round ${noisy.medianMs.toFixed(2)}ms`).toBeLessThan(
      BUDGETS.endOfRoundHeavyMs,
    );
    expect(large.medianMs, `large end of round ${large.medianMs.toFixed(2)}ms`).toBeLessThan(
      BUDGETS.endOfRoundLargeMs,
    );
  });

  it("applies a player command within budget", () => {
    for (const f of [fixtures.heavy, fixtures.large]) {
      const command = endTurnCommand(f.state);
      if (command === undefined) throw new Error("fixture is not in a player turn");
      const m = measure(
        f.name,
        () => new MatchRuntime(f.state, 0, { invariantLevel: "critical" }).apply(command),
        quick,
      );
      expect(m.medianMs, `${f.name} command ${m.medianMs.toFixed(2)}ms`).toBeLessThan(
        BUDGETS.playerCommandMs,
      );
    }
  });

  it("generates cities within budget", () => {
    const small = measure(
      "default",
      () => generateCity({ ...DEFAULT_CITY_OPTIONS, seed: 1 }),
      quick,
    );
    const large = measure("large", () => generateCity({ ...LARGE_CITY, seed: 1 }), {
      ...quick,
      iterations: 5,
    });
    expect(small.medianMs, `default city ${small.medianMs.toFixed(2)}ms`).toBeLessThan(
      BUDGETS.generateCityDefaultMs,
    );
    expect(large.medianMs, `large city ${large.medianMs.toFixed(2)}ms`).toBeLessThan(
      BUDGETS.generateCityLargeMs,
    );
  });

  it("checkpoints and checks invariants within budget", () => {
    const fp = measure("fingerprint", () => fingerprint(fixtures.large.state), quick);
    const inv = measure("invariants", () => checkInvariants(fixtures.heavy.state, "full"), quick);
    expect(fp.medianMs, `fingerprint ${fp.medianMs.toFixed(2)}ms`).toBeLessThan(
      BUDGETS.fingerprintLargeMs,
    );
    expect(inv.medianMs, `invariants ${inv.medianMs.toFixed(2)}ms`).toBeLessThan(
      BUDGETS.invariantsFullMs,
    );
  });

  it("keeps update payloads within budget", () => {
    const bytes = (state: GameState) =>
      Buffer.byteLength(
        encodeMessage({ t: "update", revision: 1, state: redactState(state), events: [] }),
      );
    expect(bytes(fixtures.heavy.state)).toBeLessThan(BUDGETS.updateBytesHeavy);
    expect(bytes(fixtures.large.state)).toBeLessThan(BUDGETS.updateBytesLarge);
  });
});
