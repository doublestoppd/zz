import { SMALL_TEST_MAP, type GameState, type InvariantViolation } from "@zombie/game-core";
import { describe, expect, it } from "vitest";
import { metrics } from "../observability/metrics.js";
import type { ClientSession } from "../session/ClientSession.js";
import { verifyJournal } from "../replay/verifier.js";
import { ServerMatch, type MatchDependencies } from "./ServerMatch.js";

interface FakeSession extends ClientSession {
  readonly sent: unknown[];
}

function fakeSession(id: string): FakeSession {
  const sent: unknown[] = [];
  return {
    id,
    sent,
    address: "test",
    matchCode: undefined,
    playerId: undefined,
    send(message) {
      sent.push(message);
    },
    close: () => undefined,
  };
}

/** A checker that flags every state in which player 1 stands on the given tile. */
function poisoned(x: number, y: number): MatchDependencies["invariantCheck"] {
  return (state: GameState): InvariantViolation[] => {
    const p1 = state.players[0];
    return p1?.position.x === x && p1.position.y === y
      ? [{ code: "OCCUPANCY", detail: `test: ${x},${y} is poisoned` }]
      : [];
  };
}

function deps(invariantCheck: MatchDependencies["invariantCheck"]): MatchDependencies {
  return {
    createSeed: () => 7,
    createRejoinToken: () => "token",
    createLayout: () => ({
      layout: SMALL_TEST_MAP,
      source: { kind: "fixture", name: "SMALL_TEST_MAP" },
    }),
    invariantLevel: "full",
    ...(invariantCheck === undefined ? {} : { invariantCheck }),
  };
}

describe("invariant guard in the runtime", () => {
  it("refuses a mutation whose result breaks an invariant and keeps the last good state", () => {
    const before = metrics.counterValue("zombie_invariant_violations_total", { code: "OCCUPANCY" });
    const match = new ServerMatch("GRD1", deps(poisoned(2, 1)));
    const a = fakeSession("a");
    match.join(a, "Ann");
    expect(match.start(a)).toBeUndefined();
    const revisionBefore = match.describe().revision;
    const entriesBefore = match.journal()?.entries.length;

    // A perfectly legal move onto the poisoned tile: the rules accept it, the guard does not.
    match.handleCommand(a, {
      commandId: "c1",
      baseRevision: revisionBefore ?? 0,
      command: { type: "move", to: { x: 2, y: 1 } },
    } as never);
    expect(a.sent.at(-1)).toMatchObject({ t: "error", code: "INTERNAL_ERROR" });
    expect(a.sent.some((m) => (m as { t: string; commandId?: string }).commandId === "c1")).toBe(
      false,
    );
    const after = match.describe();
    expect(after.revision).toBe(revisionBefore);
    expect(after.invariantViolations).toBe(1);
    expect(match.journal()?.entries.length).toBe(entriesBefore);
    expect(metrics.counterValue("zombie_invariant_violations_total", { code: "OCCUPANCY" })).toBe(
      before + 1,
    );

    // The match goes on from the state it had: a different move at the same revision works.
    match.handleCommand(a, {
      commandId: "c2",
      baseRevision: revisionBefore ?? 0,
      command: { type: "move", to: { x: 1, y: 2 } },
    } as never);
    expect(a.sent.at(-1)).toMatchObject({ t: "update", commandId: "c2", revision: 1 });
    const journal = match.journal();
    if (journal === undefined) throw new Error("no journal");
    expect(verifyJournal(journal)).toMatchObject({ ok: true, entries: 1 });
  });

  it("does not refuse anything with the real checker on ordinary play", () => {
    const match = new ServerMatch("GRD2", deps(undefined));
    const a = fakeSession("a");
    match.join(a, "Ann");
    match.start(a);
    match.handleCommand(a, {
      commandId: "c1",
      baseRevision: 0,
      command: { type: "move", to: { x: 2, y: 1 } },
    } as never);
    match.handleCommand(a, {
      commandId: "c2",
      baseRevision: 1,
      command: { type: "end_turn" },
    } as never);
    expect(match.describe()).toMatchObject({ revision: 2, invariantViolations: 0 });
  });
});
