import { itemId } from "../../ids.js";
import { makeNoise } from "../../rules/noise.js";
import { rollSearchLoot, validateSearch } from "../../rules/search.js";
import { replacePlayer } from "../../state/players.js";
import type { GameState, GroundItem, ItemType } from "../../state/types.js";
import { requireActivePlayer } from "../turnChecks.js";
import type { SearchCommand } from "../types.js";
import { ok, type CommandResult } from "./result.js";

/**
 * Searching pays the action points, marks the container searched forever, and rolls its
 * loot. Found items go into the survivor's inventory while there is room; the rest are
 * dropped on the container's tile as ordinary ground items so nothing is lost and the
 * existing pick-up rules apply.
 */
export function applySearch(state: GameState, command: SearchCommand): CommandResult {
  const check = requireActivePlayer(state, command.playerId);
  if (!check.ok) return check;
  const search = validateSearch(state, check.player, command.containerId);
  if (!search.ok) return search;

  const found = rollSearchLoot(state, search.container);
  const room = Math.max(0, check.player.inventoryCapacity - check.player.inventory.length);
  const carried: ItemType[] = found.slice(0, room);
  const dropped: ItemType[] = found.slice(room);
  const groundItems: GroundItem[] = dropped.map((type, index) => ({
    id: itemId(`${search.container.id}-i${index + 1}`),
    type,
    position: search.container.position,
  }));

  const searched = replacePlayer(state, {
    ...check.player,
    actionPoints: check.player.actionPoints - search.cost,
    inventory: [...check.player.inventory, ...carried],
  });
  const noise = makeNoise(
    {
      ...searched,
      containers: searched.containers.map((c) =>
        c.id === search.container.id ? { ...c, searched: true } : c,
      ),
      items: [...searched.items, ...groundItems],
    },
    search.container.position,
    state.rules.searchNoise,
    "search",
  );
  return ok({
    state: noise.state,
    events: [
      {
        type: "container_searched",
        playerId: command.playerId,
        containerId: search.container.id,
        category: search.container.category,
        found,
        carried,
        dropped,
        actionPointsSpent: search.cost,
      },
      ...noise.events,
    ],
  });
}
