import type { ItemDefinition, ItemType, LootTableEntry } from "@zombie/game-core";

/** One entry per `ItemType`; the compiler rejects a missing one. */
export const ITEM_DEFINITIONS: Readonly<Record<ItemType, ItemDefinition>> = {
  bandage: { effect: { kind: "heal", amount: 3 }, useActionPointCost: 1 },
  medkit: { effect: { kind: "heal", amount: 5 }, useActionPointCost: 1 },
  ammo_box: { effect: { kind: "ammo", rounds: 6 }, useActionPointCost: 1 },
};

/** Relative weights used when rolling what lies at each loot spawn. */
export const LOOT_TABLE: readonly LootTableEntry[] = [
  { type: "bandage", weight: 2 },
  { type: "medkit", weight: 1 },
  { type: "ammo_box", weight: 2 },
];
