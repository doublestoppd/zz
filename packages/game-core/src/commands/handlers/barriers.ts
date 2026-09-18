import { removeFromInventory } from "../../rules/items.js";
import { validateCloseDoor, validateForceEntry, validateOpenDoor } from "../../rules/barriers.js";
import { makeNoise } from "../../rules/noise.js";
import { setBarrierState } from "../../state/barriers.js";
import { replacePlayer } from "../../state/players.js";
import type { GameState, ItemType } from "../../state/types.js";
import { requireActivePlayer } from "../turnChecks.js";
import type { CloseDoorCommand, ForceEntryCommand, OpenDoorCommand } from "../types.js";
import { ok, type CommandResult } from "./result.js";

/** Opens a closed door, or a locked one at the price of a carried key. */
export function applyOpenDoor(state: GameState, command: OpenDoorCommand): CommandResult {
  const check = requireActivePlayer(state, command.playerId);
  if (!check.ok) return check;
  const open = validateOpenDoor(state, check.player, command.barrierId);
  if (!open.ok) return open;

  const keyType = open.usesKey ? keyItemType(state) : undefined;
  const paid = replacePlayer(state, {
    ...check.player,
    actionPoints: check.player.actionPoints - open.cost,
    inventory:
      keyType === undefined
        ? check.player.inventory
        : removeFromInventory(check.player.inventory, keyType),
  });
  return ok({
    state: setBarrierState(paid, open.barrier.id, "open"),
    events: [
      {
        type: "door_opened",
        playerId: command.playerId,
        barrierId: open.barrier.id,
        position: open.barrier.position,
        usedKey: open.usesKey,
        actionPointsSpent: open.cost,
      },
    ],
  });
}

export function applyCloseDoor(state: GameState, command: CloseDoorCommand): CommandResult {
  const check = requireActivePlayer(state, command.playerId);
  if (!check.ok) return check;
  const close = validateCloseDoor(state, check.player, command.barrierId);
  if (!close.ok) return close;

  const paid = replacePlayer(state, {
    ...check.player,
    actionPoints: check.player.actionPoints - close.cost,
  });
  return ok({
    state: setBarrierState(paid, close.barrier.id, "closed"),
    events: [
      {
        type: "door_closed",
        playerId: command.playerId,
        barrierId: close.barrier.id,
        position: close.barrier.position,
        actionPointsSpent: close.cost,
      },
    ],
  });
}

/** Breaks a locked door or a window for good, loudly: the noise goes through `makeNoise`. */
export function applyForceEntry(state: GameState, command: ForceEntryCommand): CommandResult {
  const check = requireActivePlayer(state, command.playerId);
  if (!check.ok) return check;
  const force = validateForceEntry(state, check.player, command.barrierId);
  if (!force.ok) return force;

  const paid = replacePlayer(state, {
    ...check.player,
    actionPoints: check.player.actionPoints - force.cost,
  });
  const noise = makeNoise(
    setBarrierState(paid, force.barrier.id, "broken"),
    force.barrier.position,
    state.rules.forceEntryNoise,
    "forced_entry",
  );
  return ok({
    state: noise.state,
    events: [
      {
        type: "barrier_forced",
        playerId: command.playerId,
        barrierId: force.barrier.id,
        kind: force.barrier.kind,
        position: force.barrier.position,
        actionPointsSpent: force.cost,
      },
      ...noise.events,
    ],
  });
}

/** The first carried item type whose effect is `key`; validation guarantees one exists. */
function keyItemType(state: GameState): ItemType | undefined {
  const player = state.players.find(
    (p) => state.phase.kind === "player_turn" && p.id === state.phase.activePlayerId,
  );
  return player?.inventory.find((type) => state.rules.itemDefinitions[type].effect.kind === "key");
}
