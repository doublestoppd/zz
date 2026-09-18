import type { GameEvent } from "../events/types.js";
import type { Rng } from "../random/rng.js";
import { damagePlayer } from "../rules/health.js";
import { replacePlayer } from "../state/players.js";
import { positionsEqual } from "../map/position.js";
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
  const remembered = withMemory(current, zombie, decision, events);
  switch (decision.kind) {
    case "attack": {
      const damage = remembered.rules.zombieDefinitions[zombie.type].damage;
      const outcome = damagePlayer(decision.target, damage);
      events.push(
        { type: "zombie_attacked", zombieId: zombie.id, targetId: decision.target.id, damage },
        ...outcome.events,
      );
      return replacePlayer(remembered, outcome.player);
    }
    case "step": {
      events.push({
        type: "zombie_moved",
        zombieId: zombie.id,
        from: zombie.position,
        to: decision.to,
      });
      return replaceZombie(remembered, zombie.id, (z) => ({ ...z, position: decision.to }));
    }
    case "wait":
      return remembered;
  }
}

/** Stores the decision's investigation memory on the zombie, announcing a newly chosen spot. */
function withMemory(
  state: GameState,
  zombie: ZombieState,
  decision: ZombieDecision,
  events: GameEvent[],
): GameState {
  const next = decision.kind === "attack" ? undefined : decision.investigating;
  const before = zombie.investigating;
  const unchanged =
    (next === undefined && before === undefined) ||
    (next !== undefined && before !== undefined && positionsEqual(next, before));
  if (unchanged) return state;
  if (next !== undefined)
    events.push({ type: "zombie_investigating", zombieId: zombie.id, position: next });
  return replaceZombie(state, zombie.id, (z) => {
    const { investigating: _forgotten, ...rest } = z;
    return next === undefined ? rest : { ...rest, investigating: next };
  });
}

function replaceZombie(
  state: GameState,
  id: ZombieState["id"],
  update: (zombie: ZombieState) => ZombieState,
): GameState {
  return { ...state, zombies: state.zombies.map((z) => (z.id === id ? update(z) : z)) };
}
