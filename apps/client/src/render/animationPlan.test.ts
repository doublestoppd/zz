import { describe, expect, it } from "vitest";
import { applyCommand, zombieId } from "@zombie/game-core";
import { makeClientTestState, P1, P2 } from "../input/testState.js";
import { planAnimations } from "./animationPlan.js";

describe("planAnimations", () => {
  it("turns a move into a footstep sound and a path tween", () => {
    const before = makeClientTestState();
    const result = applyCommand(before, { type: "move", playerId: P1, to: { x: 2, y: 1 } });
    if (!result.ok) throw new Error(result.reason);
    expect(planAnimations(result.events, before, result.state, P1)).toEqual([
      { kind: "sound", name: "step" },
      { kind: "move", entityId: P1, path: [{ x: 2, y: 1 }] },
    ]);
  });

  it("finds a dead target's position in the previous snapshot", () => {
    const before = makeClientTestState(["#####", "#S.Z#", "#S..#", "#####"]);
    const weak = { ...before, zombies: before.zombies.map((z) => ({ ...z, health: 1 })) };
    const result = applyCommand(weak, {
      type: "fire_weapon",
      playerId: P1,
      targetId: zombieId("z1"),
    });
    if (!result.ok) throw new Error(result.reason);
    const steps = planAnimations(result.events, weak, result.state, P1);
    expect(steps).toContainEqual({ kind: "shot", from: { x: 1, y: 1 }, to: { x: 3, y: 1 } });
    expect(steps).toContainEqual({ kind: "vanish", entityId: "z1" });
    expect(
      steps.filter((s) => s.kind === "sound").map((s) => (s.kind === "sound" ? s.name : "")),
    ).toEqual(["shot", "hit"]);
  });

  it("plays the turn chime only for my own turn", () => {
    const before = makeClientTestState();
    const result = applyCommand(before, { type: "end_turn", playerId: P1 });
    if (!result.ok) throw new Error(result.reason);
    expect(planAnimations(result.events, before, result.state, P2)).toContainEqual({
      kind: "sound",
      name: "your_turn",
    });
    expect(planAnimations(result.events, before, result.state, P1)).toEqual([]);
  });
});
