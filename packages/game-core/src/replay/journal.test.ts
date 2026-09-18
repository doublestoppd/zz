import { describe, expect, it } from "vitest";
import { applyCommand } from "../commands/applyCommand.js";
import type { Command } from "../commands/types.js";
import { matchId } from "../ids.js";
import { parseAsciiMap } from "../map/asciiMap.js";
import { createRng } from "../random/rng.js";
import { legalFireTargets, legalMoveDestinations } from "../rules/index.js";
import type { GameState } from "../state/types.js";
import { makeTestState, P1, P2 } from "../testing/makeTestState.js";
import { SIMULATION_VERSION } from "../version.js";
import { canonicalJson, fingerprint } from "./canonical.js";
import { journalEntry, replayJournal, type MatchJournal } from "./journal.js";

const LAYOUT = parseAsciiMap(["#########", "#S..Z..E#", "#S..L..E#", "#########"]);

function initial(seed: number): GameState {
  return makeTestState({ players: [P1, P2], layout: LAYOUT, seed });
}

/** Records a short random match as a journal, the way the server does. */
function record(seed: number, steps: number): MatchJournal {
  let state = initial(seed);
  const rng = createRng(seed);
  const entries = [];
  let revision = 0;
  for (let i = 0; i < steps; i += 1) {
    const phase = state.phase;
    if (phase.kind !== "player_turn") break;
    const me = state.players.find((p) => p.id === phase.activePlayerId)!;
    const options: Command[] = [{ type: "end_turn", playerId: me.id }];
    for (const to of legalMoveDestinations(state, me.id))
      options.push({ type: "move", playerId: me.id, to });
    for (const z of legalFireTargets(state, me))
      options.push({ type: "fire_weapon", playerId: me.id, targetId: z.id });
    if (i % 5 === 4)
      options.push({ type: "set_player_presence", playerId: P2, present: i % 10 === 4 });
    const command = rng.pick(options);
    const result = applyCommand(state, command);
    if (!result.ok) continue;
    state = result.state;
    revision += 1;
    entries.push(journalEntry(revision, command, state));
  }
  return {
    journalVersion: 1,
    metadata: {
      matchId: matchId("test-match"),
      seed,
      gameVersion: "test",
      protocolVersion: 3,
      simulationVersion: SIMULATION_VERSION,
      scenario: "extraction",
      layout: { kind: "fixture", name: "LAYOUT" },
      players: [P1, P2].map((id) => ({ id, name: id, specialty: "survivor" as const })),
    },
    initialCheckpoint: fingerprint(initial(seed)),
    entries,
  };
}

describe("canonical fingerprints", () => {
  it("ignore key order and undefined fields", () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [2, { f: 1, e: 2 }] } })).toBe(
      '{"a":{"c":[2,{"e":2,"f":1}]},"b":1}',
    );
    expect(fingerprint({ x: 1, y: 2 })).toBe(fingerprint({ y: 2, x: 1 }));
    expect(fingerprint({ x: 1 })).not.toBe(fingerprint({ x: 2 }));
  });
});

describe("replayJournal", () => {
  it("re-simulates a recorded match to the same checkpoints and final state", () => {
    for (const seed of [1, 2, 3]) {
      const journal = record(seed, 40);
      expect(journal.entries.length).toBeGreaterThan(5);
      const verdict = replayJournal(journal, initial(seed));
      expect(verdict).toMatchObject({ ok: true, entries: journal.entries.length });
      expect(replayJournal(journal, initial(seed))).toEqual(verdict);
    }
  });

  it("refuses a journal from another simulation version before touching the state", () => {
    const journal = record(1, 10);
    const other = {
      ...journal,
      metadata: { ...journal.metadata, simulationVersion: SIMULATION_VERSION + 1 },
    };
    expect(replayJournal(other, initial(1))).toEqual({
      ok: false,
      reason: "UNSUPPORTED_SIMULATION_VERSION",
      recorded: SIMULATION_VERSION + 1,
      supported: SIMULATION_VERSION,
    });
  });

  it("detects a changed initial state, a changed rule, and a changed command", () => {
    const journal = record(2, 30);
    expect(replayJournal(journal, initial(3))).toMatchObject({
      ok: false,
      reason: "INITIAL_STATE_MISMATCH",
    });
    // A deliberate simulation change (pistol damage) diverges at the first shot or move that depends on it.
    const changedRules: GameState = {
      ...initial(2),
      rules: { ...initial(2).rules, moveCostPerTile: 2 },
    };
    const withSameStart = { ...journal, initialCheckpoint: fingerprint(changedRules) };
    const verdict = replayJournal(withSameStart, changedRules);
    expect(verdict.ok).toBe(false);
    expect(["CHECKPOINT_MISMATCH", "COMMAND_REJECTED"]).toContain(
      !verdict.ok ? verdict.reason : "",
    );
    // A tampered command is caught at its own revision.
    const firstMove = journal.entries.findIndex((e) => e.command.type === "move");
    if (firstMove >= 0) {
      const entries = journal.entries.map((e, i) =>
        i === firstMove && e.command.type === "move"
          ? {
              ...e,
              command: { ...e.command, to: { x: e.command.to.x, y: e.command.to.y === 1 ? 2 : 1 } },
            }
          : e,
      );
      const tampered = replayJournal({ ...journal, entries }, initial(2));
      expect(tampered.ok).toBe(false);
      if (
        !tampered.ok &&
        tampered.reason !== "UNSUPPORTED_SIMULATION_VERSION" &&
        tampered.reason !== "INITIAL_STATE_MISMATCH"
      ) {
        expect(tampered.revision).toBe(journal.entries[firstMove]!.revision);
      }
    }
  });
});
