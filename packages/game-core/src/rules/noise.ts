import type { GameEvent } from "../events/types.js";
import { noiseId } from "../ids.js";
import { chebyshevDistance } from "../map/position.js";
import type { Position } from "../map/types.js";
import type { GameState, NoiseEvent, NoiseSourceType } from "../state/types.js";

export interface NoiseOutcome {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

/**
 * Records a noise at `position`. An intensity of 0 makes no noise at all (silent actions
 * simply do not appear in the world). The noise is heard in the next zombie phase and
 * stays for `noiseDurationRounds` phases in total.
 */
export function makeNoise(
  state: GameState,
  position: Position,
  intensity: number,
  sourceType: NoiseSourceType,
): NoiseOutcome {
  if (intensity <= 0) return { state, events: [] };
  const counter = state.noiseCounter + 1;
  const noise: NoiseEvent = {
    id: noiseId(`n${counter}`),
    position,
    intensity,
    remainingRounds: state.rules.noiseDurationRounds,
    sourceType,
  };
  return {
    state: {
      ...state,
      noises: [...state.noises, noise],
      noiseCounter: counter,
      heat: state.heat + intensity,
    },
    events: [{ type: "noise_made", noiseId: noise.id, position, intensity, sourceType }],
  };
}

/** Whether a listener at `from` can hear `noise`: within its intensity, walls ignored. */
export function canHear(from: Position, noise: NoiseEvent): boolean {
  return chebyshevDistance(from, noise.position) <= noise.intensity;
}

/**
 * How attractive a noise is to a listener: louder and closer is better. Used by zombie
 * target selection; ties are broken by creation order (earlier id wins).
 */
export function noiseScore(from: Position, noise: NoiseEvent): number {
  return noise.intensity - chebyshevDistance(from, noise.position);
}

/**
 * Ages every noise by one zombie phase and forgets the ones that ran out. Called once at
 * the end of each zombie phase, after the zombies have evaluated them.
 */
export function decayNoises(state: GameState): GameState {
  if (state.noises.length === 0) return state;
  const noises = state.noises
    .map((n) => ({ ...n, remainingRounds: n.remainingRounds - 1 }))
    .filter((n) => n.remainingRounds > 0);
  return { ...state, noises };
}
