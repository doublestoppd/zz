import type { ItemId } from "../ids.js";
import { positionsEqual } from "../map/position.js";
import type { ItemDefinition } from "../state/definitions.js";
import type { GameState, GroundItem, ItemType, PlayerState } from "../state/types.js";

export type PickUpRejectionReason =
  "ITEM_NOT_FOUND" | "ITEM_NOT_HERE" | "INVENTORY_FULL" | "INSUFFICIENT_ACTION_POINTS";

export type PickUpValidation =
  | { readonly ok: true; readonly item: GroundItem; readonly cost: number }
  | { readonly ok: false; readonly reason: PickUpRejectionReason };

export type UseItemRejectionReason =
  "ITEM_NOT_CARRIED" | "ITEM_NOT_USABLE" | "HEALTH_ALREADY_FULL" | "INSUFFICIENT_ACTION_POINTS";

export type UseItemValidation =
  | { readonly ok: true; readonly definition: ItemDefinition }
  | { readonly ok: false; readonly reason: UseItemRejectionReason };

/** Items lying on the player's own tile; the only ones they can pick up. */
export function itemsUnderPlayer(state: GameState, player: PlayerState): GroundItem[] {
  return state.items.filter((item) => positionsEqual(item.position, player.position));
}

/** Reasons in order: the item exists, it is on the player's tile, there is room, action points. */
export function validatePickUp(
  state: GameState,
  player: PlayerState,
  itemId: ItemId,
): PickUpValidation {
  const item = state.items.find((i) => i.id === itemId);
  if (item === undefined) return { ok: false, reason: "ITEM_NOT_FOUND" };
  if (!positionsEqual(item.position, player.position))
    return { ok: false, reason: "ITEM_NOT_HERE" };
  if (player.inventory.length >= player.inventoryCapacity)
    return { ok: false, reason: "INVENTORY_FULL" };
  const cost = state.rules.pickUpActionPointCost;
  if (player.actionPoints < cost) return { ok: false, reason: "INSUFFICIENT_ACTION_POINTS" };
  return { ok: true, item, cost };
}

/**
 * Reasons in order: the item is carried, it can be used on its own, the effect would do
 * something, action points. A medkit at full health is refused so a click cannot waste it;
 * ammo always has a use; a key is only ever spent by opening a locked door.
 */
export function validateUseItem(
  state: GameState,
  player: PlayerState,
  itemType: ItemType,
): UseItemValidation {
  if (!player.inventory.includes(itemType)) return { ok: false, reason: "ITEM_NOT_CARRIED" };
  const definition = state.rules.itemDefinitions[itemType];
  if (definition.effect.kind === "key") return { ok: false, reason: "ITEM_NOT_USABLE" };
  if (definition.effect.kind === "heal" && player.health >= player.maxHealth) {
    return { ok: false, reason: "HEALTH_ALREADY_FULL" };
  }
  if (player.actionPoints < definition.useActionPointCost) {
    return { ok: false, reason: "INSUFFICIENT_ACTION_POINTS" };
  }
  return { ok: true, definition };
}

/** Removes one item of `itemType` from the inventory (the first match). */
export function removeFromInventory(
  inventory: readonly ItemType[],
  itemType: ItemType,
): ItemType[] {
  const index = inventory.indexOf(itemType);
  return index === -1
    ? [...inventory]
    : [...inventory.slice(0, index), ...inventory.slice(index + 1)];
}
