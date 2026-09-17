import type { GameEvent } from "../events/types.js";
import type { Rng } from "../random/rng.js";
import { damagePlayer } from "../rules/health.js";
import { replacePlayer } from "../state/players.js";
import type { GameState, ZombieState } from "../state/types.js";
import { decideZombieAction } from "./targetSelection.js";

export interface ZombiePhaseOutcome {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

/**
 * Every zombie acts once, in id order, each seeing the board as left by the previous one.
 * No randomness is consumed yet; `rng` is accepted so that behaviour which needs it later
 * (for example tie-breaking or special zombie types) has its dependency in place.
 */
export function runZombiePhase(state: GameState, _rng: Rng): ZombiePhaseOutcome {
  let current = state;
  const events: GameEvent[] = [];

  for (const original of state.zombies) {
    const zombie = current.zombies.find((z) => z.id === original.id);
    if (zombie === undefined) continue;
    const decision = decideZombieAction(current, zombie);
    switch (decision.kind) {
      case "attack": {
        const damage = current.rules.zombieDefinitions[zombie.type].damage;
        const outcome = damagePlayer(decision.target, damage);
        current = replacePlayer(current, outcome.player);
        events.push(
          { type: "zombie_attacked", zombieId: zombie.id, targetId: decision.target.id, damage },
          ...outcome.events,
        );
        break;
      }
      case "step": {
        const moved: ZombieState = { ...zombie, position: decision.to };
        current = {
          ...current,
          zombies: current.zombies.map((z) => (z.id === zombie.id ? moved : z)),
        };
        events.push({
          type: "zombie_moved",
          zombieId: zombie.id,
          from: zombie.position,
          to: decision.to,
        });
        break;
      }
      case "wait":
        break;
    }
  }
  return { state: current, events };
}
