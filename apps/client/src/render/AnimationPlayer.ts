import type { ItemId, PlayerId, ZombieId } from "@zombie/game-core";
import type { AnimationStep, SoundName } from "./animationPlan.js";
import { tileCenter, type Pixel } from "./boardGeometry.js";

/** Milliseconds per tile of movement, and for the shot and flash effects. */
export const MOVE_MS_PER_TILE = 110;
export const EFFECT_MS = 160;

/** What the player needs from a sprite: its tweenable object and a body whose colour can flash. */
export interface AnimatedSprite {
  readonly target: object;
  readonly setBodyColour: (colour: "damage" | "heal" | "normal") => void;
}

export interface TweenRequest {
  readonly target: object;
  readonly x?: number;
  readonly y?: number;
  readonly scale?: number;
  readonly alpha?: number;
  readonly duration: number;
  readonly yoyo?: boolean;
}

/**
 * Everything the player asks the rendering layer to do. `BoardRenderer` implements it with
 * Phaser; tests implement it with a recorder.
 */
export interface AnimationStage {
  spriteFor(id: PlayerId | ZombieId | ItemId): AnimatedSprite | undefined;
  tween(request: TweenRequest): Promise<void>;
  wait(ms: number): Promise<void>;
  drawShot(from: Pixel, to: Pixel): void;
  clearEffects(): void;
  play(sound: SoundName): void;
}

/**
 * Plays animation steps in order on a stage. A newer `play` (or `cancel`) stops the one in
 * progress at its next await, so the renderer can snap to a newer snapshot at any time.
 */
export class AnimationPlayer {
  private token = 0;

  constructor(private readonly stage: AnimationStage) {}

  /** Stops any playback in progress; its promise resolves `false`. */
  cancel(): void {
    this.token += 1;
    this.stage.clearEffects();
  }

  /** Resolves `true` when every step finished, `false` when cancelled part-way. */
  async play(steps: readonly AnimationStep[]): Promise<boolean> {
    this.cancel();
    const token = this.token;
    // Sounds are fire-and-forget and must not wait behind tweens.
    for (const step of steps) if (step.kind === "sound") this.stage.play(step.name);

    for (const step of steps) {
      if (token !== this.token) return false;
      switch (step.kind) {
        case "move": {
          const sprite = this.stage.spriteFor(step.entityId);
          if (sprite === undefined) break;
          for (const tile of step.path) {
            const { x, y } = tileCenter(tile);
            await this.stage.tween({ target: sprite.target, x, y, duration: MOVE_MS_PER_TILE });
            if (token !== this.token) return false;
          }
          break;
        }
        case "shot":
          this.stage.drawShot(tileCenter(step.from), tileCenter(step.to));
          await this.stage.wait(EFFECT_MS);
          this.stage.clearEffects();
          break;
        case "flash": {
          const sprite = this.stage.spriteFor(step.entityId);
          if (sprite === undefined) break;
          sprite.setBodyColour(step.tone);
          await this.stage.tween({
            target: sprite.target,
            scale: 1.25,
            duration: EFFECT_MS / 2,
            yoyo: true,
          });
          sprite.setBodyColour("normal");
          break;
        }
        case "vanish": {
          const sprite = this.stage.spriteFor(step.entityId);
          if (sprite === undefined) break;
          await this.stage.tween({
            target: sprite.target,
            alpha: 0,
            scale: 0.3,
            duration: EFFECT_MS,
          });
          break;
        }
        case "sound":
          break;
      }
    }
    return token === this.token;
  }
}
