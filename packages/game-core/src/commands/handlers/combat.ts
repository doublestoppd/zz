import { validateFire, validateMelee, validateReload } from "../../rules/combat.js";
import { damageZombie } from "../../rules/health.js";
import { makeNoise } from "../../rules/noise.js";
import { replacePlayer } from "../../state/players.js";
import type { GameState, ZombieState } from "../../state/types.js";
import { requireActivePlayer } from "../turnChecks.js";
import type { FireWeaponCommand, MeleeAttackCommand, ReloadCommand } from "../types.js";
import { ok, type CommandResult } from "./result.js";

/** The board after `target` took a hit: removed when it died, replaced otherwise. */
function withHitZombie(
  zombies: readonly ZombieState[],
  target: ZombieState,
  after: ZombieState | undefined,
): ZombieState[] {
  return after === undefined
    ? zombies.filter((z) => z.id !== target.id)
    : zombies.map((z) => (z.id === target.id ? after : z));
}

export function applyFireWeapon(state: GameState, command: FireWeaponCommand): CommandResult {
  const check = requireActivePlayer(state, command.playerId);
  if (!check.ok) return check;
  const fire = validateFire(state, check.player, command.targetId);
  if (!fire.ok) return fire;

  const shooter = replacePlayer(state, {
    ...check.player,
    actionPoints: check.player.actionPoints - fire.weapon.attackActionPointCost,
    weapon: { ...check.player.weapon, loadedAmmo: check.player.weapon.loadedAmmo - 1 },
  });
  const hit = damageZombie(fire.target, fire.damage);
  // The shot is heard at the shooter's tile, whatever it hit.
  const noise = makeNoise(
    { ...shooter, zombies: withHitZombie(shooter.zombies, fire.target, hit.zombie) },
    check.player.position,
    fire.weapon.noise,
    "gunfire",
  );
  return ok({
    state: noise.state,
    events: [
      {
        type: "weapon_fired",
        playerId: command.playerId,
        weaponType: check.player.weapon.type,
        targetId: fire.target.id,
        actionPointsSpent: fire.weapon.attackActionPointCost,
      },
      ...hit.events,
      ...noise.events,
    ],
  });
}

export function applyReload(state: GameState, command: ReloadCommand): CommandResult {
  const check = requireActivePlayer(state, command.playerId);
  if (!check.ok) return check;
  const reload = validateReload(state, check.player);
  if (!reload.ok) return reload;

  const { ammoType } = reload.weapon;
  const loadedAmmo = check.player.weapon.loadedAmmo + reload.roundsLoaded;
  const reserve = check.player.reserveAmmo[ammoType] - reload.roundsLoaded;
  const reloaded = replacePlayer(state, {
    ...check.player,
    actionPoints: check.player.actionPoints - reload.weapon.reloadActionPointCost,
    weapon: { ...check.player.weapon, loadedAmmo },
    reserveAmmo: { ...check.player.reserveAmmo, [ammoType]: reserve },
  });
  return ok({
    state: reloaded,
    events: [
      {
        type: "weapon_reloaded",
        playerId: command.playerId,
        loadedAmmo,
        ammoType,
        reserveAmmo: reserve,
        actionPointsSpent: reload.weapon.reloadActionPointCost,
      },
    ],
  });
}

/**
 * A melee strike: pays the action points, damages the adjacent target, shoves it back if
 * the weapon knocks back and it survived, and makes the weapon's noise (0 for a knife).
 */
export function applyMeleeAttack(state: GameState, command: MeleeAttackCommand): CommandResult {
  const check = requireActivePlayer(state, command.playerId);
  if (!check.ok) return check;
  const melee = validateMelee(state, check.player, command.targetId);
  if (!melee.ok) return melee;

  const attacker = replacePlayer(state, {
    ...check.player,
    actionPoints: check.player.actionPoints - melee.weapon.attackActionPointCost,
  });
  const hit = damageZombie(melee.target, melee.weapon.damage);
  const shoved =
    hit.zombie !== undefined && melee.knockbackTo !== undefined
      ? { ...hit.zombie, position: melee.knockbackTo }
      : hit.zombie;
  const noise = makeNoise(
    { ...attacker, zombies: withHitZombie(attacker.zombies, melee.target, shoved) },
    check.player.position,
    melee.weapon.noise,
    "melee",
  );
  return ok({
    state: noise.state,
    events: [
      {
        type: "weapon_swung",
        playerId: command.playerId,
        weaponType: check.player.meleeWeapon,
        targetId: melee.target.id,
        actionPointsSpent: melee.weapon.attackActionPointCost,
      },
      ...hit.events,
      ...(shoved !== undefined && melee.knockbackTo !== undefined
        ? [
            {
              type: "zombie_knocked_back" as const,
              zombieId: melee.target.id,
              from: melee.target.position,
              to: melee.knockbackTo,
            },
          ]
        : []),
      ...noise.events,
    ],
  });
}
