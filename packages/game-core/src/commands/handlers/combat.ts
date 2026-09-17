import { validateFire, validateReload } from "../../rules/combat.js";
import { damageZombie } from "../../rules/health.js";
import { replacePlayer } from "../../state/players.js";
import type { GameState } from "../../state/types.js";
import { requireActivePlayer } from "../turnChecks.js";
import type { FireWeaponCommand, ReloadCommand } from "../types.js";
import { ok, type CommandResult } from "./result.js";

export function applyFireWeapon(state: GameState, command: FireWeaponCommand): CommandResult {
  const check = requireActivePlayer(state, command.playerId);
  if (!check.ok) return check;
  const fire = validateFire(state, check.player, command.targetId);
  if (!fire.ok) return fire;

  const shooter = replacePlayer(state, {
    ...check.player,
    actionPoints: check.player.actionPoints - fire.weapon.fireActionPointCost,
    weapon: { ...check.player.weapon, loadedAmmo: check.player.weapon.loadedAmmo - 1 },
  });
  const hit = damageZombie(fire.target, fire.weapon.damage);
  const survivor = hit.zombie;
  const zombies =
    survivor === undefined
      ? shooter.zombies.filter((z) => z.id !== fire.target.id)
      : shooter.zombies.map((z) => (z.id === fire.target.id ? survivor : z));
  return ok({
    state: { ...shooter, zombies },
    events: [
      {
        type: "weapon_fired",
        playerId: command.playerId,
        weaponType: check.player.weapon.type,
        targetId: fire.target.id,
        actionPointsSpent: fire.weapon.fireActionPointCost,
      },
      ...hit.events,
    ],
  });
}

export function applyReload(state: GameState, command: ReloadCommand): CommandResult {
  const check = requireActivePlayer(state, command.playerId);
  if (!check.ok) return check;
  const reload = validateReload(state, check.player);
  if (!reload.ok) return reload;

  const loadedAmmo = check.player.weapon.loadedAmmo + reload.roundsLoaded;
  const reserveAmmo = check.player.reserveAmmo - reload.roundsLoaded;
  const reloaded = replacePlayer(state, {
    ...check.player,
    actionPoints: check.player.actionPoints - reload.weapon.reloadActionPointCost,
    weapon: { ...check.player.weapon, loadedAmmo },
    reserveAmmo,
  });
  return ok({
    state: reloaded,
    events: [
      {
        type: "weapon_reloaded",
        playerId: command.playerId,
        loadedAmmo,
        reserveAmmo,
        actionPointsSpent: reload.weapon.reloadActionPointCost,
      },
    ],
  });
}
