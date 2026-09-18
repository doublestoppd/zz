import {
  barrierAt,
  legalFireTargets,
  legalMeleeTargets,
  positionsEqual,
  searchableContainersInReach,
  validateOpenDoor,
  type GameState,
  type PlayerId,
  type Position,
} from "@zombie/game-core";
import type { ClientCommand } from "@zombie/protocol";
import { decideMoveIntent } from "./moveIntent.js";

/**
 * Turns a tile click into the one command it can mean: fire at the zombie standing there
 * if that shot is legal, else strike it with the melee weapon if it is adjacent (the V key
 * strikes even when a shot is possible), else search the unsearched container there if it
 * is in reach,
 * else open the door there if it is in reach (a locked door is still asked for, so the
 * server's "locked" answer tells the player about keys and forcing), else move there if
 * that move is legal, else nothing. Closing and forcing are deliberate acts, reached
 * through the HUD buttons and keys rather than a click that might be a mis-aimed move.
 * The server remains the authority; a command returned here can still be rejected.
 */
export function decideClickIntent(
  state: GameState,
  me: PlayerId,
  tile: Position,
): ClientCommand | undefined {
  if (state.phase.kind !== "player_turn" || state.phase.activePlayerId !== me) return undefined;
  const player = state.players.find((p) => p.id === me);
  if (player === undefined) return undefined;
  const target = legalFireTargets(state, player).find((z) => positionsEqual(z.position, tile));
  if (target !== undefined) return { type: "fire_weapon", targetId: target.id };
  const adjacent = legalMeleeTargets(state, player).find((z) => positionsEqual(z.position, tile));
  if (adjacent !== undefined) return { type: "melee_attack", targetId: adjacent.id };
  const container = searchableContainersInReach(state, player).find((c) =>
    positionsEqual(c.position, tile),
  );
  if (container !== undefined) return { type: "search", containerId: container.id };
  const barrier = barrierAt(state, tile);
  if (barrier?.kind === "door") {
    const open = validateOpenDoor(state, player, barrier.id);
    if (open.ok || open.reason === "DOOR_LOCKED") {
      return { type: "open_door", barrierId: barrier.id };
    }
  }
  return decideMoveIntent(state, me, tile);
}
