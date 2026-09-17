import type { GameEvent, GameState, PlayerId, ZombieId } from "@zombie/game-core";

function nameOf(state: GameState, id: PlayerId | ZombieId): string {
  return state.players.find((p) => p.id === id)?.name ?? `Zombie ${id}`;
}

/** One human-readable line per event, for the HUD log. */
export function describeEvent(event: GameEvent, state: GameState): string {
  switch (event.type) {
    case "player_moved": {
      const end = event.path.at(-1);
      const to = end === undefined ? "" : ` to (${end.x}, ${end.y})`;
      return `${nameOf(state, event.playerId)} moved${to} (${event.actionPointsSpent} AP)`;
    }
    case "weapon_fired":
      return `${nameOf(state, event.playerId)} fires the ${event.weaponType} at zombie ${event.targetId}`;
    case "weapon_reloaded":
      return `${nameOf(state, event.playerId)} reloads (${event.loadedAmmo} loaded, ${event.reserveAmmo} left)`;
    case "entity_died":
      return `Zombie ${event.entityId} is destroyed`;
    case "turn_ended":
      return `${nameOf(state, event.playerId)} ended their turn`;
    case "turn_started":
      return `${nameOf(state, event.playerId)}'s turn`;
    case "round_started":
      return `Round ${event.round}`;
    case "phase_changed":
      return event.phase.kind === "zombie_phase" ? "Zombie phase" : "";
    case "player_presence_changed":
      return `${nameOf(state, event.playerId)} ${event.present ? "reconnected" : "disconnected"}`;
    case "zombie_moved":
      return `Zombie ${event.zombieId} shambles to (${event.to.x}, ${event.to.y})`;
    case "zombie_attacked":
      return `Zombie ${event.zombieId} attacks ${nameOf(state, event.targetId)} for ${event.damage}`;
    case "entity_damaged":
      return `${nameOf(state, event.entityId)} has ${event.remainingHealth} HP left`;
    case "player_downed":
      return `${nameOf(state, event.playerId)} is down!`;
    case "extraction_progress":
      return event.roundsHeld === 0
        ? "Extraction zone abandoned; hold count reset"
        : `Holding the extraction zone (${event.roundsHeld}/${event.holdoutRounds + 1})`;
    case "match_ended":
      return event.outcome === "victory" ? "Victory!" : "Defeat.";
  }
}
