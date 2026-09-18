import type { ZombieId } from "../ids.js";
import { chebyshevDistance, isInBounds, tileAt } from "../map/position.js";
import type { Position } from "../map/types.js";
import type { FirearmDefinition, MeleeWeaponDefinition } from "../state/definitions.js";
import type { GameState, PlayerState, ZombieState } from "../state/types.js";
import { hasLineOfSight } from "./lineOfSight.js";
import { canStandOn } from "./occupancy.js";
import { discounted, modifiersOf } from "./specialties.js";

export type FireRejectionReason =
  | "TARGET_NOT_FOUND"
  | "OUT_OF_RANGE"
  | "NO_LINE_OF_SIGHT"
  | "WEAPON_EMPTY"
  | "INSUFFICIENT_ACTION_POINTS";

export type FireValidation =
  | {
      readonly ok: true;
      readonly target: ZombieState;
      readonly weapon: FirearmDefinition;
      /** Damage this shot will do, after any distance falloff. */
      readonly damage: number;
    }
  | { readonly ok: false; readonly reason: FireRejectionReason };

export type ReloadRejectionReason =
  "MAGAZINE_FULL" | "NO_RESERVE_AMMO" | "INSUFFICIENT_ACTION_POINTS";

export type ReloadValidation =
  | {
      readonly ok: true;
      readonly roundsLoaded: number;
      readonly weapon: FirearmDefinition;
      /** Action points the reload costs this survivor (specialty discount applied). */
      readonly cost: number;
    }
  | { readonly ok: false; readonly reason: ReloadRejectionReason };

export type MeleeRejectionReason =
  "TARGET_NOT_FOUND" | "NOT_ADJACENT" | "INSUFFICIENT_ACTION_POINTS";

export type MeleeValidation =
  | {
      readonly ok: true;
      readonly target: ZombieState;
      readonly weapon: MeleeWeaponDefinition;
      /** Where a surviving target is shoved, when the weapon knocks back and the tile is free. */
      readonly knockbackTo: Position | undefined;
    }
  | { readonly ok: false; readonly reason: MeleeRejectionReason };

/** The definition behind the survivor's firearm slot. The slot is typed to hold only firearms. */
export function firearmOf(state: GameState, player: PlayerState): FirearmDefinition {
  const weapon = state.rules.weaponDefinitions[player.weapon.type];
  if (weapon.kind !== "firearm") {
    throw new Error(`weapon slot holds ${player.weapon.type}, which is not a firearm`);
  }
  return weapon;
}

/** The definition behind the survivor's melee slot. */
export function meleeWeaponOf(state: GameState, player: PlayerState): MeleeWeaponDefinition {
  const weapon = state.rules.weaponDefinitions[player.meleeWeapon];
  if (weapon.kind !== "melee") {
    throw new Error(`melee slot holds ${player.meleeWeapon}, which is not a melee weapon`);
  }
  return weapon;
}

/** Damage of a firearm at a Chebyshev distance: the falloff table if it reaches that far, else base damage. */
export function damageAtDistance(weapon: FirearmDefinition, distance: number): number {
  return weapon.damageByDistance?.[distance - 1] ?? weapon.damage;
}

/**
 * Decides whether `player` may fire at the zombie `targetId`. Turn checks are the caller's
 * job. Reasons are reported in this order: target, range, line of sight, ammo, action points.
 * Damage is deterministic; there is no hit roll.
 */
export function validateFire(
  state: GameState,
  player: PlayerState,
  targetId: ZombieId,
): FireValidation {
  const target = state.zombies.find((z) => z.id === targetId);
  if (target === undefined) return { ok: false, reason: "TARGET_NOT_FOUND" };
  const weapon = firearmOf(state, player);
  const distance = chebyshevDistance(player.position, target.position);
  if (distance > weapon.range) return { ok: false, reason: "OUT_OF_RANGE" };
  if (!hasLineOfSight(state, player.position, target.position)) {
    return { ok: false, reason: "NO_LINE_OF_SIGHT" };
  }
  if (player.weapon.loadedAmmo <= 0) return { ok: false, reason: "WEAPON_EMPTY" };
  if (player.actionPoints < weapon.attackActionPointCost) {
    return { ok: false, reason: "INSUFFICIENT_ACTION_POINTS" };
  }
  return { ok: true, target, weapon, damage: damageAtDistance(weapon, distance) };
}

/** A reload fills the magazine from the reserve of the weapon's ammunition kind, as far as it allows. */
export function validateReload(state: GameState, player: PlayerState): ReloadValidation {
  const weapon = firearmOf(state, player);
  const space = weapon.magazineSize - player.weapon.loadedAmmo;
  if (space <= 0) return { ok: false, reason: "MAGAZINE_FULL" };
  const reserve = player.reserveAmmo[weapon.ammoType];
  if (reserve <= 0) return { ok: false, reason: "NO_RESERVE_AMMO" };
  const cost = discounted(
    weapon.reloadActionPointCost,
    modifiersOf(state, player).reloadActionPointDiscount,
  );
  if (player.actionPoints < cost) return { ok: false, reason: "INSUFFICIENT_ACTION_POINTS" };
  return { ok: true, roundsLoaded: Math.min(space, reserve), weapon, cost };
}

/**
 * Decides whether `player` may strike the zombie `targetId` with their melee weapon.
 * Reasons in order: target, adjacency (Chebyshev distance within the weapon's range, so
 * diagonals count), action points. No ammunition and no line-of-sight check: adjacent
 * tiles have nothing between them. An `unshakable` zombie type is never knocked back.
 */
export function validateMelee(
  state: GameState,
  player: PlayerState,
  targetId: ZombieId,
): MeleeValidation {
  const target = state.zombies.find((z) => z.id === targetId);
  if (target === undefined) return { ok: false, reason: "TARGET_NOT_FOUND" };
  const weapon = meleeWeaponOf(state, player);
  if (chebyshevDistance(player.position, target.position) > weapon.range) {
    return { ok: false, reason: "NOT_ADJACENT" };
  }
  if (player.actionPoints < weapon.attackActionPointCost) {
    return { ok: false, reason: "INSUFFICIENT_ACTION_POINTS" };
  }
  const unshakable = state.rules.zombieDefinitions[target.type].unshakable === true;
  const knockbackTo =
    weapon.knockback === true && !unshakable
      ? knockbackDestination(state, player.position, target)
      : undefined;
  return { ok: true, target, weapon, knockbackTo };
}

/** One tile directly away from the attacker, if the zombie could stand there right now. */
function knockbackDestination(
  state: GameState,
  attacker: Position,
  target: ZombieState,
): Position | undefined {
  const to = {
    x: target.position.x + Math.sign(target.position.x - attacker.x),
    y: target.position.y + Math.sign(target.position.y - attacker.y),
  };
  if (!isInBounds(state.map, to) || !(tileAt(state.map, to)?.walkable ?? false)) return undefined;
  return canStandOn(state, to, { kind: "zombie", id: target.id }) ? to : undefined;
}

/** Zombies `player` could legally fire at right now. Used by the client to mark targets. */
export function legalFireTargets(state: GameState, player: PlayerState): ZombieState[] {
  return state.zombies.filter((z) => validateFire(state, player, z.id).ok);
}

/** Zombies `player` could legally strike right now. Used by the client to mark targets. */
export function legalMeleeTargets(state: GameState, player: PlayerState): ZombieState[] {
  return state.zombies.filter((z) => validateMelee(state, player, z.id).ok);
}
