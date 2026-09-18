import type {
  ContainerCategory,
  ItemType,
  SpecialtyType,
  WeaponType,
  ZombieType,
} from "@zombie/game-core";

/**
 * Every image the board uses, by texture key. All files are CC0 art from Kenney's
 * "Topdown Shooter" and "Generic Items" packs (docs/CREDITS.md), served from
 * `public/assets/kenney`. The scene preloads the whole manifest before the first render.
 */
export const ASSET_ROOT = "/assets/kenney";

/** Source tiles are 64 px; the board draws them at `TILE_SIZE`. */
export const SOURCE_TILE = 64;

/** Character poses in the pack: which arms and weapon the figure shows. */
export type Pose = "gun" | "machine" | "hold" | "stand";
const POSES: readonly Pose[] = ["gun", "machine", "hold", "stand"];

/** Which pack character stands in for each specialty. */
export const SPECIALTY_CHARACTER: Readonly<Record<SpecialtyType, string>> = {
  survivor: "survivor1",
  paramedic: "womanGreen",
  officer: "soldier1",
  mechanic: "manBrown",
  athlete: "manRed",
  scavenger: "survivor2",
};

/** The pack's two zombie figures; the brute is the first one drawn larger and darker. */
export const ZOMBIE_CHARACTER: Readonly<Record<ZombieType, string>> = {
  walker: "zombie1",
  runner: "zombie2",
  brute: "zombie1",
};

/** How large each zombie draws relative to a survivor, and its tint. */
export const ZOMBIE_LOOK: Readonly<Record<ZombieType, { scale: number; tint: number }>> = {
  walker: { scale: 1, tint: 0xffffff },
  runner: { scale: 0.92, tint: 0xd8f0c0 },
  brute: { scale: 1.35, tint: 0xa88a80 },
};

/** The pose a survivor's firearm implies. Melee is a separate slot and never changes the figure. */
export const WEAPON_POSE: Readonly<Record<WeaponType, Pose>> = {
  pistol: "gun",
  shotgun: "machine",
  rifle: "machine",
  knife: "hold",
  bat: "hold",
};

export const TILE_KEYS = {
  grass: ["grass_1", "grass_2", "grass_3", "grass_4"],
  wood: ["wood_1", "wood_2", "wood_3"],
  concrete: ["concrete_1", "concrete_2"],
  asphalt: ["asphalt", "asphalt", "asphalt", "asphalt_mark"],
  brick: ["brick_1", "brick_2", "brick_3"],
} as const;

export const FURNITURE_KEYS = {
  doorClosed: "door_closed",
  doorOpen: "door_open",
  doorBroken: "door_broken",
  window: "window",
  windowBroken: "window_broken",
  extraction: "extraction",
} as const;

export const CONTAINER_KEYS: Readonly<Record<ContainerCategory, string>> = {
  home: "container_home",
  clinic: "container_clinic",
  police: "container_police",
  shop: "container_shop",
};

export const ITEM_KEYS: Readonly<Record<ItemType, string>> = {
  bandage: "item_bandage",
  medkit: "item_medkit",
  ammo_box: "item_ammo_box",
  shell_box: "item_shell_box",
  rifle_clip: "item_rifle_clip",
  key: "item_key",
  radio_parts: "item_radio_parts",
  pistol: "item_pistol",
  shotgun: "item_shotgun",
  rifle: "item_rifle",
  knife: "item_knife",
  bat: "item_bat",
};

export function characterKey(character: string, pose: Pose): string {
  return `char_${character}_${pose}`;
}

export interface AssetEntry {
  readonly key: string;
  /** Path under `public/`, so it doubles as the URL. */
  readonly url: string;
}

/** Everything to preload, derived from the tables above so nothing can be forgotten. */
export function assetManifest(): AssetEntry[] {
  const entries: AssetEntry[] = [];
  const tile = (key: string) => entries.push({ key, url: `${ASSET_ROOT}/tiles/${key}.png` });
  for (const keys of Object.values(TILE_KEYS)) for (const key of new Set(keys)) tile(key);
  for (const key of Object.values(FURNITURE_KEYS)) {
    entries.push({ key, url: `${ASSET_ROOT}/furniture/${key}.png` });
  }
  for (const key of Object.values(CONTAINER_KEYS)) {
    entries.push({ key, url: `${ASSET_ROOT}/furniture/${key}.png` });
  }
  for (const [type, key] of Object.entries(ITEM_KEYS)) {
    entries.push({ key, url: `${ASSET_ROOT}/items/${type}.png` });
  }
  const characters = new Set(Object.values(SPECIALTY_CHARACTER));
  for (const character of characters) {
    for (const pose of POSES) {
      entries.push({
        key: characterKey(character, pose),
        url: `${ASSET_ROOT}/chars/${character}_${pose}.png`,
      });
    }
  }
  for (const zombie of new Set(Object.values(ZOMBIE_CHARACTER))) {
    entries.push({
      key: characterKey(zombie, "hold"),
      url: `${ASSET_ROOT}/chars/${zombie}_hold.png`,
    });
  }
  return entries;
}

/** A stable pick from `keys` for a tile, so the board looks the same on every client and render. */
export function variant<T>(keys: readonly T[], x: number, y: number): T {
  const hash = (x * 73856093) ^ (y * 19349663);
  const index = Math.abs(hash) % keys.length;
  return keys[index] as T;
}
