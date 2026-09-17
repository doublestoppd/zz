import type { GameEvent } from "../events/types.js";
import type { PlayerState, ZombieState } from "../state/types.js";

export interface DamageOutcome {
  readonly player: PlayerState;
  readonly events: readonly GameEvent[];
}

/**
 * Removes `damage` health from a survivor. Health never goes below zero; reaching zero
 * sets the `down` status. Armour or other mitigation, when added, happens before this call:
 * `damage` is final health damage.
 */
export function damagePlayer(player: PlayerState, damage: number): DamageOutcome {
  const remainingHealth = Math.max(0, player.health - damage);
  const downed = remainingHealth === 0 && player.status === "active";
  const updated: PlayerState = {
    ...player,
    health: remainingHealth,
    status: downed ? "down" : player.status,
  };
  const events: GameEvent[] = [
    { type: "entity_damaged", entityId: player.id, damage, remainingHealth },
  ];
  if (downed) events.push({ type: "player_downed", playerId: player.id });
  return { player: updated, events };
}

export interface ZombieDamageOutcome {
  /** Undefined when the zombie died and must be removed from the board. */
  readonly zombie: ZombieState | undefined;
  readonly events: readonly GameEvent[];
}

/** Removes `damage` health from a zombie. At zero the zombie dies and leaves the board. */
export function damageZombie(zombie: ZombieState, damage: number): ZombieDamageOutcome {
  const remainingHealth = Math.max(0, zombie.health - damage);
  const events: GameEvent[] = [
    { type: "entity_damaged", entityId: zombie.id, damage, remainingHealth },
  ];
  if (remainingHealth === 0) {
    events.push({ type: "entity_died", entityId: zombie.id });
    return { zombie: undefined, events };
  }
  return { zombie: { ...zombie, health: remainingHealth }, events };
}
