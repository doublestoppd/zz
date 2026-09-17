import type { GameEvent, GameState, PlayerId } from "@zombie/game-core";

function nameOf(state: GameState, id: PlayerId): string {
  return state.players.find((p) => p.id === id)?.name ?? id;
}

/** One human-readable line per event, for the HUD log. */
export function describeEvent(event: GameEvent, state: GameState): string {
  switch (event.type) {
    case "player_moved": {
      const end = event.path.at(-1);
      const to = end === undefined ? "" : ` to (${end.x}, ${end.y})`;
      return `${nameOf(state, event.playerId)} moved${to} (${event.actionPointsSpent} AP)`;
    }
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
    case "match_ended":
      return event.outcome === "victory" ? "Victory!" : "Defeat.";
  }
}
