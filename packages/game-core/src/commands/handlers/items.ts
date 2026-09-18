import type { GameEvent } from "../../events/types.js";
import { itemId } from "../../ids.js";
import { removeFromInventory, validatePickUp, validateUseItem } from "../../rules/items.js";
import { modifiersOf } from "../../rules/specialties.js";
import { replacePlayer } from "../../state/players.js";
import type { GameState, GroundItem, PlayerState, WeaponType } from "../../state/types.js";
import { requireActivePlayer } from "../turnChecks.js";
import type { PickUpCommand, UseItemCommand } from "../types.js";
import { ok, type CommandResult } from "./result.js";

export function applyPickUp(state: GameState, command: PickUpCommand): CommandResult {
  const check = requireActivePlayer(state, command.playerId);
  if (!check.ok) return check;
  const pickUp = validatePickUp(state, check.player, command.itemId);
  if (!pickUp.ok) return pickUp;

  const effect = state.rules.itemDefinitions[pickUp.item.type].effect;
  if (effect.kind === "weapon") return equipWeapon(state, check.player, pickUp, effect.weaponType);

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

/**
 * Picking up a weapon swaps it into the slot of its kind. The weapon it replaces is
 * dropped on the survivor's tile as a ground item, so the swap can be undone; a replaced
 * firearm is unloaded first (its rounds return to the reserve) and the new firearm starts
 * empty, so a swap costs a reload.
 */
function equipWeapon(
  state: GameState,
  player: PlayerState,
  pickUp: { readonly item: GroundItem; readonly cost: number },
  weaponType: WeaponType,
): CommandResult {
  const definition = state.rules.weaponDefinitions[weaponType];
  const paid: PlayerState = { ...player, actionPoints: player.actionPoints - pickUp.cost };
  let equipped: PlayerState;
  let replaced: WeaponType;
  if (definition.kind === "firearm") {
    const old = state.rules.weaponDefinitions[player.weapon.type];
    const unloaded =
      old.kind === "firearm"
        ? {
            ...paid.reserveAmmo,
            [old.ammoType]: paid.reserveAmmo[old.ammoType] + player.weapon.loadedAmmo,
          }
        : paid.reserveAmmo;
    replaced = player.weapon.type;
    equipped = { ...paid, weapon: { type: weaponType, loadedAmmo: 0 }, reserveAmmo: unloaded };
  } else {
    replaced = player.meleeWeapon;
    equipped = { ...paid, meleeWeapon: weaponType };
  }
  const dropped: GroundItem = {
    id: itemId(`${pickUp.item.id}-x`),
    type: replaced,
    position: player.position,
  };
  const next = replacePlayer(state, equipped);
  return ok({
    state: {
      ...next,
      items: [...next.items.filter((i) => i.id !== pickUp.item.id), dropped],
    },
    events: [
      {
        type: "item_picked_up",
        playerId: player.id,
        itemId: pickUp.item.id,
        itemType: pickUp.item.type,
        actionPointsSpent: pickUp.cost,
      },
      {
        type: "weapon_equipped",
        playerId: player.id,
        weaponType,
        replaced,
        droppedItemId: dropped.id,
      },
    ],
  });
}

export function applyUseItem(state: GameState, command: UseItemCommand): CommandResult {
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
      const amount = effect.amount + modifiersOf(state, check.player).healBonus;
      const health = Math.min(base.maxHealth, base.health + amount);
      return ok({
        state: replacePlayer(state, { ...base, health }),
        events: [
          used,
          { type: "player_healed", playerId: base.id, amount: health - base.health, health },
        ],
      });
    }
    case "ammo": {
      const reserve = base.reserveAmmo[effect.ammoType] + effect.rounds;
      return ok({
        state: replacePlayer(state, {
          ...base,
          reserveAmmo: { ...base.reserveAmmo, [effect.ammoType]: reserve },
        }),
        events: [
          used,
          {
            type: "ammo_gained",
            playerId: base.id,
            ammoType: effect.ammoType,
            rounds: effect.rounds,
            reserveAmmo: reserve,
          },
        ],
      });
    }
    case "key":
    case "weapon":
      // Unreachable: validateUseItem refuses both. Kept so the switch stays exhaustive.
      return { ok: false, reason: "ITEM_NOT_USABLE" };
  }
}
