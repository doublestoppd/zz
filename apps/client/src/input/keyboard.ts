import {
  chebyshevDistance,
  itemsUnderPlayer,
  legalFireTargets,
  searchableContainersInReach,
  type GameState,
  type PlayerId,
  type Position,
} from "@zombie/game-core";
import type { ClientCommand } from "@zombie/protocol";
import { decideMoveIntent } from "./moveIntent.js";

const DIRECTIONS: Readonly<Record<string, Position>> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  w: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
};

/** Keys and what they do, for the help text. Keep in sync with `keyToCommand`. */
export const KEY_HELP: readonly (readonly [string, string])[] = [
  ["Arrows / WASD", "move one tile"],
  ["F", "fire at the nearest zombie in range"],
  ["R", "reload"],
  ["P", "pick up the item underfoot"],
  ["Q", "search the nearest container in reach"],
  ["E", "end turn"],
];

/**
 * Maps a key press to the command it means on my turn, or nothing. Pure so it is testable;
 * the scene only forwards `KeyboardEvent.key`.
 */
export function keyToCommand(
  key: string,
  state: GameState,
  me: PlayerId,
): ClientCommand | undefined {
  if (state.phase.kind !== "player_turn" || state.phase.activePlayerId !== me) return undefined;
  const player = state.players.find((p) => p.id === me);
  if (player === undefined) return undefined;

  const direction = DIRECTIONS[key];
  if (direction !== undefined) {
    return decideMoveIntent(state, me, {
      x: player.position.x + direction.x,
      y: player.position.y + direction.y,
    });
  }
  switch (key.toLowerCase()) {
    case "e":
      return { type: "end_turn" };
    case "r":
      return { type: "reload" };
    case "p": {
      const item = itemsUnderPlayer(state, player)[0];
      return item === undefined ? undefined : { type: "pick_up", itemId: item.id };
    }
    case "q": {
      const container = searchableContainersInReach(state, player)[0];
      return container === undefined ? undefined : { type: "search", containerId: container.id };
    }
    case "f": {
      const targets = legalFireTargets(state, player);
      if (targets.length === 0) return undefined;
      const nearest = targets.reduce((best, z) =>
        chebyshevDistance(player.position, z.position) <
        chebyshevDistance(player.position, best.position)
          ? z
          : best,
      );
      return { type: "fire_weapon", targetId: nearest.id };
    }
    default:
      return undefined;
  }
}
