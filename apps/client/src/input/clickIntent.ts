import {
  legalFireTargets,
  positionsEqual,
  searchableContainersInReach,
  type GameState,
  type PlayerId,
  type Position,
} from "@zombie/game-core";
import type { ClientCommand } from "@zombie/protocol";
import { decideMoveIntent } from "./moveIntent.js";

/**
 * Turns a tile click into the one command it can mean: fire at the zombie standing there
 * if that shot is legal, else search the unsearched container there if it is in reach,
 * else move there if that move is legal, else nothing. The server remains the authority;
 * a command returned here can still be rejected.
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
  const container = searchableContainersInReach(state, player).find((c) =>
    positionsEqual(c.position, tile),
  );
  if (container !== undefined) return { type: "search", containerId: container.id };
  return decideMoveIntent(state, me, tile);
}
