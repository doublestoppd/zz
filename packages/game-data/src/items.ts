import type { ItemDefinition, ItemType, LootTableEntry } from "@zombie/game-core";

/** One entry per `ItemType`; the compiler rejects a missing one. */
export const ITEM_DEFINITIONS: Readonly<Record<ItemType, ItemDefinition>> = {
  bandage: { effect: { kind: "heal", amount: 3 }, useActionPointCost: 1 },
  medkit: { effect: { kind: "heal", amount: 5 }, useActionPointCost: 1 },
  ammo_box: {
    effect: { kind: "ammo", ammoType: "pistol_rounds", rounds: 6 },
    useActionPointCost: 1,
  },
  shell_box: { effect: { kind: "ammo", ammoType: "shells", rounds: 4 }, useActionPointCost: 1 },
  rifle_clip: {
    effect: { kind: "ammo", ammoType: "rifle_rounds", rounds: 5 },
    useActionPointCost: 1,
  },
  /** Spent by opening a locked door; never used directly, so the cost is moot. */
  key: { effect: { kind: "key" }, useActionPointCost: 0 },
  /** The retrieval scenario's prize: carried back to the safehouse, never used. */
  radio_parts: { effect: { kind: "objective" }, useActionPointCost: 0 },
  /** Weapons are equipped by picking them up; they never sit in the inventory. */
  pistol: { effect: { kind: "weapon", weaponType: "pistol" }, useActionPointCost: 0 },
  shotgun: { effect: { kind: "weapon", weaponType: "shotgun" }, useActionPointCost: 0 },
  rifle: { effect: { kind: "weapon", weaponType: "rifle" }, useActionPointCost: 0 },
  knife: { effect: { kind: "weapon", weaponType: "knife" }, useActionPointCost: 0 },
  bat: { effect: { kind: "weapon", weaponType: "bat" }, useActionPointCost: 0 },
};

/** Relative weights used when rolling what lies at each loot spawn. */
export const LOOT_TABLE: readonly LootTableEntry[] = [
  { type: "bandage", weight: 2 },
  { type: "medkit", weight: 1 },
  { type: "ammo_box", weight: 2 },
  { type: "shell_box", weight: 1 },
  { type: "bat", weight: 1 },
  { type: "key", weight: 1 },
];
