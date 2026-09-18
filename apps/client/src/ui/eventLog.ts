import type {
  AmmoType,
  DynamicEventType,
  GameEvent,
  GameState,
  NoiseSourceType,
  PlayerId,
  ZombieId,
} from "@zombie/game-core";

/** Plain names for ammunition kinds; the compiler demands every kind. */
export const AMMO_LABELS: Readonly<Record<AmmoType, string>> = {
  pistol_rounds: "pistol rounds",
  shells: "shells",
  rifle_rounds: "rifle rounds",
};

/** What each noise source sounds like in the log; the compiler demands every source. */
const NOISE_LABELS: Readonly<Record<NoiseSourceType, string>> = {
  gunfire: "Gunfire",
  melee: "A scuffle",
  search: "Rummaging",
  forced_entry: "Splintering",
  alarm: "A car alarm",
};

const EVENT_LABELS: Readonly<Record<DynamicEventType, string>> = {
  car_alarm: "A car alarm goes off",
  horde: "A horde arrives from the outskirts",
  supply_cache: "A supply cache has been spotted",
};

/** "Runner z3" for a zombie still on the board, "Zombie z3" once it is gone. */
function zombieName(state: GameState, id: ZombieId): string {
  const type = state.zombies.find((z) => z.id === id)?.type;
  return `${type === undefined ? "Zombie" : type.charAt(0).toUpperCase() + type.slice(1)} ${id}`;
}

function nameOf(state: GameState, id: PlayerId | ZombieId): string {
  return state.players.find((p) => p.id === id)?.name ?? zombieName(state, id as ZombieId);
}

/** One human-readable line per event, for the HUD log. */
export function describeEvent(event: GameEvent, state: GameState): string {
  switch (event.type) {
    case "player_moved": {
      const end = event.path.at(-1);
      const to = end === undefined ? "" : ` to (${end.x}, ${end.y})`;
      return `${nameOf(state, event.playerId)} moved${to} (${event.actionPointsSpent} AP)`;
    }
    case "weapon_fired":
      return `${nameOf(state, event.playerId)} fires the ${event.weaponType} at zombie ${event.targetId}`;
    case "weapon_swung":
      return `${nameOf(state, event.playerId)} strikes zombie ${event.targetId} with the ${event.weaponType}`;
    case "weapon_reloaded":
      return `${nameOf(state, event.playerId)} reloads (${event.loadedAmmo} loaded, ${event.reserveAmmo} ${AMMO_LABELS[event.ammoType]} left)`;
    case "weapon_equipped":
      return `${nameOf(state, event.playerId)} takes the ${event.weaponType} and drops the ${event.replaced}`;
    case "zombie_knocked_back":
      return `${zombieName(state, event.zombieId)} is knocked back to (${event.to.x}, ${event.to.y})`;
    case "entity_died":
      return `Zombie ${event.entityId} is destroyed`;
    case "item_picked_up":
      return `${nameOf(state, event.playerId)} picks up a ${event.itemType.replace("_", " ")}`;
    case "container_searched": {
      const found =
        event.found.length === 0
          ? "finds nothing"
          : `finds ${event.found.map((i) => i.replace("_", " ")).join(", ")}`;
      const dropped =
        event.dropped.length === 0 ? "" : ` (${event.dropped.length} left on the floor)`;
      return `${nameOf(state, event.playerId)} searches a ${event.category} cabinet and ${found}${dropped}`;
    }
    case "item_used":
      return `${nameOf(state, event.playerId)} uses a ${event.itemType.replace("_", " ")}`;
    case "player_healed":
      return `${nameOf(state, event.playerId)} heals ${event.amount} (${event.health} HP)`;
    case "ammo_gained":
      return `${nameOf(state, event.playerId)} gains ${event.rounds} ${AMMO_LABELS[event.ammoType]} (${event.reserveAmmo} in reserve)`;
    case "turn_ended":
      return `${nameOf(state, event.playerId)} ended their turn`;
    case "turn_started":
      return `${nameOf(state, event.playerId)}'s turn`;
    case "round_started":
      return `Round ${event.round}`;
    case "phase_changed":
      return event.phase.kind === "zombie_phase" ? "Zombie phase" : "";
    case "player_presence_changed":
      return `${nameOf(state, event.playerId)} ${event.present ? "reconnected" : "disconnected"}`;
    case "zombie_moved":
      return `${zombieName(state, event.zombieId)} shambles to (${event.to.x}, ${event.to.y})`;
    case "zombie_attacked":
      return `${zombieName(state, event.zombieId)} attacks ${nameOf(state, event.targetId)} for ${event.damage}`;
    case "noise_made":
      return `${NOISE_LABELS[event.sourceType]} at (${event.position.x}, ${event.position.y}) carries ${event.intensity} tiles`;
    case "door_opened":
      return `${nameOf(state, event.playerId)} ${event.usedKey ? "unlocks and opens" : "opens"} the door at (${event.position.x}, ${event.position.y})`;
    case "door_closed":
      return `${nameOf(state, event.playerId)} closes the door at (${event.position.x}, ${event.position.y})`;
    case "barrier_forced":
      return `${nameOf(state, event.playerId)} breaks the ${event.kind} at (${event.position.x}, ${event.position.y})`;
    case "zombie_investigating":
      return `${zombieName(state, event.zombieId)} heads for the noise at (${event.position.x}, ${event.position.y})`;
    case "entity_damaged":
      return `${nameOf(state, event.entityId)} has ${event.remainingHealth} HP left`;
    case "player_downed":
      return `${nameOf(state, event.playerId)} is down!`;
    case "dynamic_event":
      return event.position === undefined
        ? EVENT_LABELS[event.event]
        : `${EVENT_LABELS[event.event]} at (${event.position.x}, ${event.position.y})`;
    case "item_dropped":
      return `A ${event.itemType.replace("_", " ")} lies at (${event.position.x}, ${event.position.y})`;
    case "threat_changed":
      return event.level > event.previous
        ? `Threat rises to level ${event.level}`
        : `Threat falls to level ${event.level}`;
    case "zombie_spawned":
      return `A ${event.zombieType} (${event.zombieId}) arrives at (${event.position.x}, ${event.position.y})`;
    case "objective_progress":
      return event.held === 0
        ? `Objective step ${event.stepIndex + 1}: progress lost, back to 0/${event.needed}`
        : `Objective step ${event.stepIndex + 1}: ${event.held}/${event.needed}`;
    case "objective_step_completed":
      return `Objective step ${event.stepIndex + 1} complete`;
    case "objective_step_started":
      return `New objective: step ${event.stepIndex + 1}`;
    case "match_ended":
      return event.outcome === "victory" ? "Victory!" : "Defeat.";
  }
}
