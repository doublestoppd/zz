import { describe, expect, it } from "vitest";
import { playerId, zombieId } from "@zombie/game-core";
import { AnimationPlayer, type AnimationStage, type TweenRequest } from "./AnimationPlayer.js";
import type { AnimationStep } from "./animationPlan.js";
import { tileCenter } from "./boardGeometry.js";

/** Records every call; tweens and waits resolve when the test says so. */
class RecordingStage implements AnimationStage {
  readonly calls: string[] = [];
  private pending: (() => void)[] = [];
  readonly sprites = new Map<string, { target: object; colours: string[] }>();

  spriteFor(id: string) {
    const entry = this.sprites.get(id);
    if (entry === undefined) return undefined;
    return { target: entry.target, setBodyColour: (c: string) => entry.colours.push(c) };
  }
  tween(request: TweenRequest): Promise<void> {
    this.calls.push(`tween ${JSON.stringify({ ...request, target: undefined })}`);
    return new Promise((resolve) => this.pending.push(resolve));
  }
  wait(ms: number): Promise<void> {
    this.calls.push(`wait ${ms}`);
    return new Promise((resolve) => this.pending.push(resolve));
  }
  drawShot(): void {
    this.calls.push("shot");
  }
  clearEffects(): void {
    this.calls.push("clear");
  }
  play(sound: string): void {
    this.calls.push(`sound ${sound}`);
  }
  /** Resolves the oldest pending tween or wait. */
  finishNext(): void {
    this.pending.shift()?.();
  }
}

const P1 = playerId("p1");
const Z1 = zombieId("z1");

describe("AnimationPlayer", () => {
  it("plays sounds immediately, then tweens each path tile in order", async () => {
    const stage = new RecordingStage();
    stage.sprites.set(P1, { target: {}, colours: [] });
    const player = new AnimationPlayer(stage);
    const steps: AnimationStep[] = [
      { kind: "sound", name: "step" },
      {
        kind: "move",
        entityId: P1,
        path: [
          { x: 2, y: 1 },
          { x: 3, y: 1 },
        ],
      },
    ];
    const done = player.play(steps);
    expect(stage.calls).toEqual([
      "clear",
      "sound step",
      `tween ${JSON.stringify({ ...tileCenter({ x: 2, y: 1 }), duration: 110 })}`,
    ]);
    stage.finishNext();
    await Promise.resolve();
    expect(stage.calls.at(-1)).toContain(
      JSON.stringify({ ...tileCenter({ x: 3, y: 1 }), duration: 110 }),
    );
    stage.finishNext();
    expect(await done).toBe(true);
  });

  it("flashes the body colour around the pulse and skips unknown sprites", async () => {
    const stage = new RecordingStage();
    stage.sprites.set(Z1, { target: {}, colours: [] });
    const player = new AnimationPlayer(stage);
    const done = player.play([
      { kind: "flash", entityId: P1, tone: "damage" },
      { kind: "flash", entityId: Z1, tone: "heal" },
    ]);
    await Promise.resolve();
    expect(stage.sprites.get(Z1)?.colours).toEqual(["heal"]);
    stage.finishNext();
    expect(await done).toBe(true);
    expect(stage.sprites.get(Z1)?.colours).toEqual(["heal", "normal"]);
  });

  it("stops at the next await when a newer play starts", async () => {
    const stage = new RecordingStage();
    stage.sprites.set(P1, { target: {}, colours: [] });
    const player = new AnimationPlayer(stage);
    const first = player.play([
      {
        kind: "move",
        entityId: P1,
        path: [
          { x: 2, y: 1 },
          { x: 3, y: 1 },
        ],
      },
    ]);
    const second = player.play([{ kind: "shot", from: { x: 1, y: 1 }, to: { x: 3, y: 1 } }]);
    stage.finishNext(); // first tween completes, but the first play has been superseded
    expect(await first).toBe(false);
    stage.finishNext(); // the shot's wait
    expect(await second).toBe(true);
    expect(stage.calls.filter((c) => c.startsWith("tween"))).toHaveLength(1);
  });
});
