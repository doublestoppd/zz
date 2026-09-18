import { visibilityGrid, type GameEvent, type GameState } from "@zombie/game-core";
import type { WireGameState } from "@zombie/protocol";

/**
 * What every client may know. The team shares one view, so one redaction serves all
 * sockets: zombies outside the current view are left out of the snapshot, and events
 * that would place a hidden zombie are dropped. Everything else (players, items, doors,
 * noises, the explored grid) is public to the team.
 */
export function redactState(state: GameState): WireGameState {
  const visible = visibilityGrid(state);
  const { map: _map, ...rest } = state;
  return {
    ...rest,
    zombies: state.zombies.filter((z) => visible[z.position.y]?.[z.position.x] === true),
  };
}

/** Drops zombie events whose position is out of sight in the snapshot they lead to. */
export function redactEvents(events: readonly GameEvent[], state: GameState): GameEvent[] {
  const visible = visibilityGrid(state);
  const shown = (p: { readonly x: number; readonly y: number }): boolean =>
    visible[p.y]?.[p.x] === true;
  return events.filter((event) => {
    if (event.type === "zombie_moved" || event.type === "zombie_knocked_back") {
      return shown(event.to);
    }
    if (event.type === "zombie_investigating" || event.type === "zombie_spawned") {
      return shown(event.position);
    }
    return true;
  });
}
