import type { ZombieId } from "../ids.js";
import { chebyshevDistance } from "../map/position.js";
import type { GameState, PlayerState, ZombieState } from "../state/types.js";
import type { WeaponDefinition } from "../state/definitions.js";
import { hasLineOfSight } from "./lineOfSight.js";

export type FireRejectionReason =
  | "TARGET_NOT_FOUND"
  | "OUT_OF_RANGE"
  | "NO_LINE_OF_SIGHT"
  | "WEAPON_EMPTY"
  | "INSUFFICIENT_ACTION_POINTS";

export type FireValidation =
  | { readonly ok: true; readonly target: ZombieState; readonly weapon: WeaponDefinition }
  | { readonly ok: false; readonly reason: FireRejectionReason };

export type ReloadRejectionReason =
  "MAGAZINE_FULL" | "NO_RESERVE_AMMO" | "INSUFFICIENT_ACTION_POINTS";

export type ReloadValidation =
  | { readonly ok: true; readonly roundsLoaded: number; readonly weapon: WeaponDefinition }
  | { readonly ok: false; readonly reason: ReloadRejectionReason };

export function weaponOf(state: GameState, player: PlayerState): WeaponDefinition {
  return state.rules.weaponDefinitions[player.weapon.type];
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
  const weapon = weaponOf(state, player);
  if (chebyshevDistance(player.position, target.position) > weapon.range) {
    return { ok: false, reason: "OUT_OF_RANGE" };
  }
  if (!hasLineOfSight(state.map, player.position, target.position)) {
    return { ok: false, reason: "NO_LINE_OF_SIGHT" };
  }
  if (player.weapon.loadedAmmo <= 0) return { ok: false, reason: "WEAPON_EMPTY" };
  if (player.actionPoints < weapon.fireActionPointCost) {
    return { ok: false, reason: "INSUFFICIENT_ACTION_POINTS" };
  }
  return { ok: true, target, weapon };
}

/** A reload fills the magazine from reserve ammo, as far as the reserve allows. */
export function validateReload(state: GameState, player: PlayerState): ReloadValidation {
  const weapon = weaponOf(state, player);
  const space = weapon.magazineSize - player.weapon.loadedAmmo;
  if (space <= 0) return { ok: false, reason: "MAGAZINE_FULL" };
  if (player.reserveAmmo <= 0) return { ok: false, reason: "NO_RESERVE_AMMO" };
  if (player.actionPoints < weapon.reloadActionPointCost) {
    return { ok: false, reason: "INSUFFICIENT_ACTION_POINTS" };
  }
  return { ok: true, roundsLoaded: Math.min(space, player.reserveAmmo), weapon };
}

/** Zombies `player` could legally fire at right now. Used by the client to mark targets. */
export function legalFireTargets(state: GameState, player: PlayerState): ZombieState[] {
  return state.zombies.filter((z) => validateFire(state, player, z.id).ok);
}
