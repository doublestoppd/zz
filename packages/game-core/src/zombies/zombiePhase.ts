import type { GameEvent } from "../events/types.js";
import type { Rng } from "../random/rng.js";
import { damagePlayer } from "../rules/health.js";
import { replacePlayer } from "../state/players.js";
import type { GameState, ZombieState } from "../state/types.js";
import { decideZombieAction, type ZombieDecision } from "./targetSelection.js";

export interface ZombiePhaseOutcome {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

/**
 * Every zombie acts in id order, each seeing the board as left by the previous one. A
 * zombie may step up to its type's `movesPerPhase` tiles, deciding afresh after each step;
 * an attack or a wait ends its activity for the phase. No randomness is consumed yet;
 * `rng` is accepted so that behaviour which needs it later has its dependency in place.
 */
export function runZombiePhase(state: GameState, _rng: Rng): ZombiePhaseOutcome {
  let current = state;
  const events: GameEvent[] = [];

  for (const original of state.zombies) {
    const moves = current.rules.zombieDefinitions[original.type].movesPerPhase;
    for (let step = 0; step < moves; step += 1) {
      const zombie = current.zombies.find((z) => z.id === original.id);
      if (zombie === undefined) break;
      const decision = decideZombieAction(current, zombie);
      if (decision.kind !== "step") {
        current = applyDecision(current, zombie, decision, events);
        break;
      }
      current = applyDecision(current, zombie, decision, events);
    }
  }
  return { state: current, events };
}

function applyDecision(
  current: GameState,
  zombie: ZombieState,
  decision: ZombieDecision,
  events: GameEvent[],
): GameState {
  switch (decision.kind) {
    case "attack": {
      const damage = current.rules.zombieDefinitions[zombie.type].damage;
      const outcome = damagePlayer(decision.target, damage);
      events.push(
        { type: "zombie_attacked", zombieId: zombie.id, targetId: decision.target.id, damage },
        ...outcome.events,
      );
      return replacePlayer(current, outcome.player);
    }
    case "step": {
      const moved: ZombieState = { ...zombie, position: decision.to };
      events.push({
        type: "zombie_moved",
        zombieId: zombie.id,
        from: zombie.position,
        to: decision.to,
      });
      return { ...current, zombies: current.zombies.map((z) => (z.id === zombie.id ? moved : z)) };
    }
    case "wait":
      return current;
  }
}
