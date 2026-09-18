import {
  barrierOptions,
  chebyshevDistance,
  itemsUnderPlayer,
  legalFireTargets,
  legalMeleeTargets,
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
  ["V", "strike the nearest adjacent zombie with your melee weapon"],
  ["R", "reload"],
  ["P", "pick up the item underfoot"],
  ["Q", "search the nearest container in reach"],
  ["O", "open the door next to you (a key opens a locked one)"],
  ["C", "close the open door next to you"],
  ["X", "force the locked door or window next to you (loud)"],
  ["E", "end turn"],
];

/** The first of `zombies` closest to `from` (Chebyshev), or undefined when there are none. */
function nearestOf<T extends { readonly position: Position }>(
  from: Position,
  zombies: readonly T[],
): T | undefined {
  return zombies.reduce<T | undefined>(
    (best, z) =>
      best === undefined ||
      chebyshevDistance(from, z.position) < chebyshevDistance(from, best.position)
        ? z
        : best,
    undefined,
  );
}

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
    case "v": {
      const targets = legalMeleeTargets(state, player);
      const nearest = nearestOf(player.position, targets);
      return nearest === undefined ? undefined : { type: "melee_attack", targetId: nearest.id };
    }
    case "o": {
      const door = barrierOptions(state, player).open[0];
      return door === undefined ? undefined : { type: "open_door", barrierId: door.id };
    }
    case "c": {
      const door = barrierOptions(state, player).close[0];
      return door === undefined ? undefined : { type: "close_door", barrierId: door.id };
    }
    case "x": {
      const barrier = barrierOptions(state, player).force[0];
      return barrier === undefined ? undefined : { type: "force_entry", barrierId: barrier.id };
    }
    case "f": {
      const nearest = nearestOf(player.position, legalFireTargets(state, player));
      return nearest === undefined ? undefined : { type: "fire_weapon", targetId: nearest.id };
    }
    default:
      return undefined;
  }
}
