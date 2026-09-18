import { describe, expect, it } from "vitest";
import { applyCommand } from "../commands/applyCommand.js";
import { barrierId } from "../ids.js";
import { parseAsciiMap } from "../map/asciiMap.js";
import { findPlayer } from "../state/players.js";
import type { GameState, SpecialtyType } from "../state/types.js";
import { makeTestState, P1 } from "../testing/makeTestState.js";
import { rollSearchLoot, validateSearch } from "./search.js";
import { validateForceEntry } from "./barriers.js";
import { validateReload } from "./combat.js";

function must(result: ReturnType<typeof applyCommand>) {
  if (!result.ok) throw new Error(result.reason);
  return result;
}

function withP1(state: GameState, patch: Partial<GameState["players"][number]>): GameState {
  return { ...state, players: state.players.map((p) => (p.id === P1 ? { ...p, ...patch } : p)) };
}

const SPECIALTIES: SpecialtyType[] = [
  "survivor",
  "paramedic",
  "officer",
  "mechanic",
  "athlete",
  "scavenger",
];

describe("specialties", () => {
  it("an athlete has one more action point every turn; nobody else does", () => {
    const athlete = makeTestState({ players: [P1], specialty: "athlete" });
    expect(findPlayer(athlete, P1)).toMatchObject({ actionPoints: 5, maxActionPoints: 5 });
    const plain = makeTestState({ players: [P1] });
    expect(findPlayer(plain, P1)).toMatchObject({ actionPoints: 4, maxActionPoints: 4 });
  });

  it("a paramedic heals two more with the same item", () => {
    const heal = (specialty: SpecialtyType) => {
      const state = withP1(makeTestState({ players: [P1], specialty }), {
        inventory: ["bandage"],
        health: 2,
      });
      return findPlayer(
        must(applyCommand(state, { type: "use_item", playerId: P1, itemType: "bandage" })).state,
        P1,
      )?.health;
    };
    expect(heal("survivor")).toBe(5);
    expect(heal("paramedic")).toBe(7);
  });

  it("an officer reloads for free", () => {
    const state = withP1(makeTestState({ players: [P1], specialty: "officer" }), {
      weapon: { type: "pistol", loadedAmmo: 0 },
    });
    expect(validateReload(state, findPlayer(state, P1)!)).toMatchObject({ ok: true, cost: 0 });
    const reloaded = must(applyCommand(state, { type: "reload", playerId: P1 }));
    expect(findPlayer(reloaded.state, P1)?.actionPoints).toBe(4);
    expect(reloaded.events[0]).toMatchObject({ actionPointsSpent: 0 });
    const plain = withP1(makeTestState({ players: [P1] }), {
      weapon: { type: "pistol", loadedAmmo: 0 },
    });
    expect(validateReload(plain, findPlayer(plain, P1)!)).toMatchObject({ ok: true, cost: 1 });
  });

  it("a mechanic forces entry cheaper and quieter", () => {
    const layout = parseAsciiMap(["#####", "#S.W#", "#####"]);
    const at = (specialty: SpecialtyType) =>
      withP1(makeTestState({ players: [P1], layout, specialty }), { position: { x: 2, y: 1 } });
    const mechanic = at("mechanic");
    expect(validateForceEntry(mechanic, findPlayer(mechanic, P1)!, barrierId("b1"))).toMatchObject({
      ok: true,
      cost: 1,
      noise: 3,
    });
    const forced = must(
      applyCommand(mechanic, { type: "force_entry", playerId: P1, barrierId: barrierId("b1") }),
    );
    expect(forced.state.noises[0]).toMatchObject({ intensity: 3 });
    expect(findPlayer(forced.state, P1)?.actionPoints).toBe(3);
    const plain = at("survivor");
    expect(validateForceEntry(plain, findPlayer(plain, P1)!, barrierId("b1"))).toMatchObject({
      ok: true,
      cost: 2,
      noise: 6,
    });
  });

  it("a scavenger searches cheaper and finds everything others would, plus one more draw", () => {
    const layout = parseAsciiMap(["####", "#SC#", "####"]);
    const scavenger = makeTestState({ players: [P1], layout, specialty: "scavenger" });
    const plain = makeTestState({ players: [P1], layout });
    expect(
      validateSearch(scavenger, findPlayer(scavenger, P1)!, scavenger.containers[0]!.id),
    ).toMatchObject({ ok: true, cost: 1 });
    expect(validateSearch(plain, findPlayer(plain, P1)!, plain.containers[0]!.id)).toMatchObject({
      ok: true,
      cost: 2,
    });
    // The clinic table never draws "nothing", so the extra roll always shows up as an item.
    const clinic = {
      ...plain,
      containers: plain.containers.map((c) => ({ ...c, category: "clinic" as const })),
    };
    const base = rollSearchLoot(clinic, clinic.containers[0]!);
    const more = rollSearchLoot(clinic, clinic.containers[0]!, 1);
    expect(more.slice(0, base.length)).toEqual(base);
    expect(more).toHaveLength(base.length + 1);
    const searched = must(
      applyCommand(scavenger, {
        type: "search",
        playerId: P1,
        containerId: scavenger.containers[0]!.id,
      }),
    );
    expect(findPlayer(searched.state, P1)?.actionPoints).toBe(3);
  });

  it("every specialty can still move, shoot, strike, search, heal, and open doors", () => {
    const layout = parseAsciiMap(["########", "#S.+.CZ#", "#......#", "########"]);
    for (const specialty of SPECIALTIES) {
      const state = withP1(makeTestState({ players: [P1], layout, specialty, zombieHealth: 9 }), {
        inventory: ["bandage"],
        health: 5,
      });
      const p = findPlayer(state, P1)!;
      expect(applyCommand(state, { type: "move", playerId: P1, to: { x: 2, y: 1 } }).ok).toBe(true);
      const atDoor = withP1(state, { position: { x: 2, y: 1 } });
      expect(
        applyCommand(atDoor, { type: "open_door", playerId: P1, barrierId: barrierId("b1") }).ok,
      ).toBe(true);
      const inside = withP1(
        { ...state, barriers: state.barriers.map((b) => ({ ...b, state: "open" as const })) },
        { position: { x: 5, y: 1 } },
      );
      expect(
        applyCommand(inside, { type: "fire_weapon", playerId: P1, targetId: state.zombies[0]!.id })
          .ok,
      ).toBe(true);
      expect(
        applyCommand(inside, { type: "melee_attack", playerId: P1, targetId: state.zombies[0]!.id })
          .ok,
      ).toBe(true);
      expect(
        applyCommand(inside, { type: "search", playerId: P1, containerId: state.containers[0]!.id })
          .ok,
      ).toBe(true);
      expect(applyCommand(state, { type: "use_item", playerId: P1, itemType: "bandage" }).ok).toBe(
        true,
      );
      expect(p.specialty).toBe(specialty);
    }
  });

  it("is deterministic for a given specialty", () => {
    const a = makeTestState({ players: [P1], specialty: "scavenger", seed: 3 });
    const b = makeTestState({ players: [P1], specialty: "scavenger", seed: 3 });
    expect(a).toEqual(b);
  });
});
