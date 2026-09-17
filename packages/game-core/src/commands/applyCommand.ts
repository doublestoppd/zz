import type { GameEvent } from "../events/types.js";
import { validateFire, validateReload } from "../rules/combat.js";
import { damageZombie } from "../rules/health.js";
import { removeFromInventory, validatePickUp, validateUseItem } from "../rules/items.js";
import { validateMove } from "../rules/movement.js";
import { replacePlayer } from "../state/players.js";
import type { GameState, PlayerState } from "../state/types.js";
import {
  advanceUntilPlayerInput,
  endActiveTurn,
  reassignTurnIfActivePlayerAbsent,
  type Transition,
} from "../turn/phases.js";
import type { RejectionReason } from "./rejection.js";
import { requireActivePlayer } from "./turnChecks.js";
import type {
  Command,
  EndTurnCommand,
  FireWeaponCommand,
  MoveCommand,
  PickUpCommand,
  ReloadCommand,
  SetPlayerPresenceCommand,
  UseItemCommand,
} from "./types.js";

export type CommandResult =
  | { readonly ok: true; readonly state: GameState; readonly events: readonly GameEvent[] }
  | { readonly ok: false; readonly reason: RejectionReason };

/**
 * The single entry point for changing game state.
 *
 * Validates `command` against `state`, applies it, then drives any non-player phases so the
 * returned state is always either waiting on a player or finished. Pure: same inputs, same
 * outputs; the gameplay Rng is rebuilt from `state.rngState` when needed.
 */
export function applyCommand(state: GameState, command: Command): CommandResult {
  const applied = applyOne(state, command);
  if (!applied.ok) return applied;
  const settled = advanceUntilPlayerInput(applied.state);
  return { ok: true, state: settled.state, events: [...applied.events, ...settled.events] };
}

function applyOne(state: GameState, command: Command): CommandResult {
  switch (command.type) {
    case "move":
      return applyMove(state, command);
    case "fire_weapon":
      return applyFireWeapon(state, command);
    case "reload":
      return applyReload(state, command);
    case "pick_up":
      return applyPickUp(state, command);
    case "use_item":
      return applyUseItem(state, command);
    case "end_turn":
      return applyEndTurn(state, command);
    case "set_player_presence":
      return ok(applySetPlayerPresence(state, command));
  }
}

function ok(transition: Transition): CommandResult {
  return { ok: true, state: transition.state, events: transition.events };
}

function applyMove(state: GameState, command: MoveCommand): CommandResult {
  const check = requireActivePlayer(state, command.playerId);
  if (!check.ok) return check;
  const move = validateMove(state, check.player, command.to);
  if (!move.ok) return move;

  const moved = replacePlayer(state, {
    ...check.player,
    position: command.to,
    actionPoints: check.player.actionPoints - move.cost,
  });
  return ok({
    state: moved,
    events: [
      {
        type: "player_moved",
        playerId: command.playerId,
        path: move.path,
        actionPointsSpent: move.cost,
      },
    ],
  });
}

function applyFireWeapon(state: GameState, command: FireWeaponCommand): CommandResult {
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

function applyReload(state: GameState, command: ReloadCommand): CommandResult {
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

function applyPickUp(state: GameState, command: PickUpCommand): CommandResult {
  const check = requireActivePlayer(state, command.playerId);
  if (!check.ok) return check;
  const pickUp = validatePickUp(state, check.player, command.itemId);
  if (!pickUp.ok) return pickUp;

  const carried = replacePlayer(state, {
    ...check.player,
    actionPoints: check.player.actionPoints - pickUp.cost,
    inventory: [...check.player.inventory, pickUp.item.type],
  });
  return ok({
    state: { ...carried, items: carried.items.filter((i) => i.id !== pickUp.item.id) },
    events: [
      {
        type: "item_picked_up",
        playerId: command.playerId,
        itemId: pickUp.item.id,
        itemType: pickUp.item.type,
        actionPointsSpent: pickUp.cost,
      },
    ],
  });
}

function applyUseItem(state: GameState, command: UseItemCommand): CommandResult {
  const check = requireActivePlayer(state, command.playerId);
  if (!check.ok) return check;
  const use = validateUseItem(state, check.player, command.itemType);
  if (!use.ok) return use;

  const { effect, useActionPointCost } = use.definition;
  const base: PlayerState = {
    ...check.player,
    actionPoints: check.player.actionPoints - useActionPointCost,
    inventory: removeFromInventory(check.player.inventory, command.itemType),
  };
  const used: GameEvent = {
    type: "item_used",
    playerId: command.playerId,
    itemType: command.itemType,
    actionPointsSpent: useActionPointCost,
  };
  switch (effect.kind) {
    case "heal": {
      const health = Math.min(base.maxHealth, base.health + effect.amount);
      return ok({
        state: replacePlayer(state, { ...base, health }),
        events: [
          used,
          { type: "player_healed", playerId: base.id, amount: health - base.health, health },
        ],
      });
    }
    case "ammo": {
      const reserveAmmo = base.reserveAmmo + effect.rounds;
      return ok({
        state: replacePlayer(state, { ...base, reserveAmmo }),
        events: [
          used,
          { type: "ammo_gained", playerId: base.id, rounds: effect.rounds, reserveAmmo },
        ],
      });
    }
  }
}

function applyEndTurn(state: GameState, command: EndTurnCommand): CommandResult {
  const check = requireActivePlayer(state, command.playerId);
  if (!check.ok) return check;
  return ok(endActiveTurn(state));
}

/**
 * Presence changes are always accepted for known players (an unknown id is a server bug,
 * reported as a rejection rather than thrown so the server keeps running). A change that
 * leaves the active player absent hands the turn on.
 */
function applySetPlayerPresence(state: GameState, command: SetPlayerPresenceCommand): Transition {
  const player = state.players.find((p) => p.id === command.playerId);
  if (player === undefined || player.present === command.present) {
    return { state, events: [] };
  }
  const updated = replacePlayer(state, { ...player, present: command.present });
  const changed: GameEvent = {
    type: "player_presence_changed",
    playerId: command.playerId,
    present: command.present,
  };
  const reassigned = reassignTurnIfActivePlayerAbsent(updated);
  return { state: reassigned.state, events: [changed, ...reassigned.events] };
}
