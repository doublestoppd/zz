import type { GameEvent } from "../../events/types.js";
import { removeFromInventory, validatePickUp, validateUseItem } from "../../rules/items.js";
import { replacePlayer } from "../../state/players.js";
import type { GameState, PlayerState } from "../../state/types.js";
import { requireActivePlayer } from "../turnChecks.js";
import type { PickUpCommand, UseItemCommand } from "../types.js";
import { ok, type CommandResult } from "./result.js";

export function applyPickUp(state: GameState, command: PickUpCommand): CommandResult {
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
