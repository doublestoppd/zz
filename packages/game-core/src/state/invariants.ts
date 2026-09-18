import type { PlayerId } from "../ids.js";
import { isInBounds, positionKey, tileAt } from "../map/position.js";
import type { GameMap, Position } from "../map/types.js";
import { isEligibleToAct } from "../turn/turnOrder.js";
import { ITEM_TYPES, type GameState, type PlayerState } from "./types.js";

/**
 * A single violated assumption. `code` is stable and machine-readable (metrics, tests);
 * `detail` says which entity and what value.
 */
export interface InvariantViolation {
  readonly code: InvariantCode;
  readonly detail: string;
}

export type InvariantCode =
  | "OCCUPANCY"
  | "OUT_OF_BOUNDS"
  | "NOT_WALKABLE"
  | "ACTION_POINTS"
  | "AMMO"
  | "HEALTH"
  | "STATUS"
  | "ACTIVE_PLAYER"
  | "TURN_ORDER"
  | "PHASE"
  | "DUPLICATE_ID"
  | "INVENTORY"
  | "WEAPON"
  | "OBJECTIVE"
  | "COUNTER"
  | "MAP";

/**
 * Which checks to run. `critical` is the cheap subset the server runs on every accepted
 * command in production (O(entities), no allocation beyond a position set): the ones
 * whose violation would let play continue on a board that breaks a rule. `full` adds the
 * reference and bookkeeping checks and is what tests, the replay verifier, and the soak
 * run after every mutation.
 */
export type InvariantLevel = "critical" | "full";

/**
 * Every assumption the rules rely on between commands, checked over a whole state.
 * Returns an empty list for a consistent state. Pure and side-effect free; the caller
 * decides what a violation means (a test fails, the server refuses the mutation).
 */
export function checkInvariants(
  state: GameState,
  level: InvariantLevel = "full",
): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const push = (code: InvariantCode, detail: string) => out.push({ code, detail });
  const { map } = state;

  checkPositions(state, push);
  checkOccupancy(state, push);
  checkPlayerNumbers(state, push);
  checkTurnAndPhase(state, push);
  if (level === "critical") return out;

  checkMap(map, push);
  checkIds(state, push);
  checkReferences(state, push);
  checkObjective(state, push);
  if (state.round < 1) push("COUNTER", `round ${state.round}`);
  if (state.zombieCounter < 0) push("COUNTER", `zombieCounter ${state.zombieCounter}`);
  if (state.noiseCounter < 0) push("COUNTER", `noiseCounter ${state.noiseCounter}`);
  if (state.threat < 0 || state.threat > state.rules.threat.maxLevel) {
    push("COUNTER", `threat ${state.threat} outside 0..${state.rules.threat.maxLevel}`);
  }
  for (const noise of state.noises) {
    if (noise.remainingRounds < 0)
      push("COUNTER", `noise ${noise.id} remainingRounds ${noise.remainingRounds}`);
    if (noise.intensity < 0) push("COUNTER", `noise ${noise.id} intensity ${noise.intensity}`);
  }
  return out;
}

/** Convenience for tests and development: throws with every violation listed. */
export function assertInvariants(state: GameState, level: InvariantLevel = "full"): void {
  const violations = checkInvariants(state, level);
  if (violations.length > 0) {
    throw new Error(
      `state invariants violated:\n${violations.map((v) => `  ${v.code}: ${v.detail}`).join("\n")}`,
    );
  }
}

type Push = (code: InvariantCode, detail: string) => void;

function onBoard(map: GameMap, p: Position, what: string, push: Push): boolean {
  if (!isInBounds(map, p)) {
    push("OUT_OF_BOUNDS", `${what} at ${positionKey(p)} outside ${map.width}x${map.height}`);
    return false;
  }
  return true;
}

function checkPositions(state: GameState, push: Push): void {
  const { map } = state;
  const walkable = (p: Position, what: string) => {
    if (!onBoard(map, p, what, push)) return;
    if (tileAt(map, p)?.walkable !== true) push("NOT_WALKABLE", `${what} at ${positionKey(p)}`);
  };
  for (const p of state.players) walkable(p.position, `player ${p.id}`);
  for (const z of state.zombies) {
    walkable(z.position, `zombie ${z.id}`);
    if (z.investigating !== undefined) onBoard(map, z.investigating, `zombie ${z.id} target`, push);
  }
  for (const i of state.items) walkable(i.position, `item ${i.id}`);
  for (const c of state.containers) onBoard(map, c.position, `container ${c.id}`, push);
  for (const b of state.barriers) {
    if (!onBoard(map, b.position, `barrier ${b.id}`, push)) continue;
    const tile = tileAt(map, b.position)?.type;
    if (tile !== b.kind)
      push("MAP", `barrier ${b.id} (${b.kind}) stands on a ${String(tile)} tile`);
  }
  for (const n of state.noises) onBoard(map, n.position, `noise ${n.id}`, push);
  for (const p of state.reinforcementSpawns) onBoard(map, p, "reinforcement spawn", push);
}

/** Survivors (standing or down) and zombies are solid: one per tile. Items and containers are not. */
function checkOccupancy(state: GameState, push: Push): void {
  const seen = new Map<string, string>();
  const claim = (p: Position, who: string) => {
    const key = positionKey(p);
    const other = seen.get(key);
    if (other !== undefined) push("OCCUPANCY", `${who} and ${other} both at ${key}`);
    else seen.set(key, who);
  };
  for (const p of state.players) claim(p.position, `player ${p.id}`);
  for (const z of state.zombies) claim(z.position, `zombie ${z.id}`);
}

function checkPlayerNumbers(state: GameState, push: Push): void {
  for (const p of state.players) {
    if (p.actionPoints < 0 || p.actionPoints > p.maxActionPoints) {
      push("ACTION_POINTS", `player ${p.id} has ${p.actionPoints} of ${p.maxActionPoints}`);
    }
    if (p.health < 0 || p.health > p.maxHealth) {
      push("HEALTH", `player ${p.id} has ${p.health} of ${p.maxHealth}`);
    }
    if (p.health === 0 && p.status !== "down")
      push("STATUS", `player ${p.id} at 0 health is ${p.status}`);
    if (p.health > 0 && p.status === "down")
      push("STATUS", `player ${p.id} is down with ${p.health} health`);
    if (p.weapon.loadedAmmo < 0) push("AMMO", `player ${p.id} loaded ${p.weapon.loadedAmmo}`);
    for (const [kind, rounds] of Object.entries(p.reserveAmmo)) {
      if (rounds < 0) push("AMMO", `player ${p.id} reserve ${kind} ${rounds}`);
    }
  }
  for (const z of state.zombies) {
    if (z.health <= 0) push("HEALTH", `zombie ${z.id} has ${z.health} health but is on the board`);
  }
}

function checkTurnAndPhase(state: GameState, push: Push): void {
  const ids = new Set<PlayerId>(state.players.map((p) => p.id));
  if (
    state.turnOrder.length !== state.players.length ||
    new Set(state.turnOrder).size !== state.turnOrder.length
  ) {
    push(
      "TURN_ORDER",
      `turn order [${state.turnOrder.join(",")}] is not a permutation of ${state.players.length} players`,
    );
  } else {
    for (const id of state.turnOrder)
      if (!ids.has(id)) push("TURN_ORDER", `turn order names unknown player ${id}`);
  }
  const phase = state.phase;
  if (phase.kind === "player_turn") {
    const active = state.players.find((p) => p.id === phase.activePlayerId);
    if (active === undefined) {
      push("ACTIVE_PLAYER", `active player ${phase.activePlayerId} does not exist`);
    } else if (!isEligibleToAct(active) && state.players.some(isEligibleToAct)) {
      // The turn may rest with an ineligible player only while nobody at all could act.
      push(
        "ACTIVE_PLAYER",
        `active player ${active.id} (${active.status}, present ${String(active.present)}) cannot act while a teammate could`,
      );
    }
    if (state.objective.status !== "in_progress") {
      push("PHASE", `player turn while objective is ${state.objective.status}`);
    }
  }
  if (phase.kind === "finished") {
    const expected = phase.outcome === "victory" ? "complete" : "failed";
    if (
      state.objective.status !== expected &&
      !(phase.outcome === "defeat" && state.objective.status === "in_progress")
    ) {
      push("PHASE", `finished with ${phase.outcome} but objective is ${state.objective.status}`);
    }
  }
}

function checkMap(map: GameMap, push: Push): void {
  if (map.tiles.length !== map.height || map.tiles.some((row) => row.length !== map.width)) {
    push("MAP", `tile grid does not match ${map.width}x${map.height}`);
  }
}

function checkIds(state: GameState, push: Push): void {
  const unique = (what: string, ids: readonly string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) push("DUPLICATE_ID", `${what} ${id}`);
      seen.add(id);
    }
  };
  unique(
    "player",
    state.players.map((p) => p.id),
  );
  unique(
    "zombie",
    state.zombies.map((z) => z.id),
  );
  unique(
    "item",
    state.items.map((i) => i.id),
  );
  unique(
    "container",
    state.containers.map((c) => c.id),
  );
  unique(
    "barrier",
    state.barriers.map((b) => b.id),
  );
  unique(
    "noise",
    state.noises.map((n) => n.id),
  );
}

const KNOWN_ITEMS: ReadonlySet<string> = new Set(ITEM_TYPES);

function checkReferences(state: GameState, push: Push): void {
  const { rules } = state;
  for (const p of state.players) checkPlayerReferences(state, p, push);
  for (const i of state.items) {
    if (!KNOWN_ITEMS.has(i.type))
      push("INVENTORY", `ground item ${i.id} has unknown type ${i.type}`);
  }
  for (const z of state.zombies) {
    if (!(z.type in rules.zombieDefinitions))
      push("WEAPON", `zombie ${z.id} has unknown type ${z.type}`);
  }
}

function checkPlayerReferences(state: GameState, p: PlayerState, push: Push): void {
  const { rules } = state;
  const firearm = rules.weaponDefinitions[p.weapon.type];
  if (firearm.kind !== "firearm") {
    push("WEAPON", `player ${p.id} firearm slot holds ${p.weapon.type} (${firearm.kind})`);
  } else if (p.weapon.loadedAmmo > firearm.magazineSize) {
    push(
      "AMMO",
      `player ${p.id} loaded ${p.weapon.loadedAmmo} into a ${firearm.magazineSize}-round ${p.weapon.type}`,
    );
  }
  if (rules.weaponDefinitions[p.meleeWeapon].kind !== "melee") {
    push("WEAPON", `player ${p.id} melee slot holds ${p.meleeWeapon}`);
  }
  if (p.inventory.length > p.inventoryCapacity) {
    push("INVENTORY", `player ${p.id} carries ${p.inventory.length} of ${p.inventoryCapacity}`);
  }
  for (const item of p.inventory) {
    if (!KNOWN_ITEMS.has(item)) push("INVENTORY", `player ${p.id} carries unknown item ${item}`);
  }
  if (!(p.specialty in rules.specialtyDefinitions)) {
    push("WEAPON", `player ${p.id} has unknown specialty ${p.specialty}`);
  }
}

function checkObjective(state: GameState, push: Push): void {
  const { objective, map } = state;
  if (objective.current < 0 || objective.current > objective.steps.length) {
    push("OBJECTIVE", `current step ${objective.current} of ${objective.steps.length}`);
  }
  if (objective.status === "complete" && objective.current !== objective.steps.length) {
    push("OBJECTIVE", `complete at step ${objective.current} of ${objective.steps.length}`);
  }
  if (objective.status === "in_progress" && objective.current >= objective.steps.length) {
    push("OBJECTIVE", `in progress past the last step`);
  }
  objective.steps.forEach((step, index) => {
    switch (step.kind) {
      case "reach_location":
        if (step.zone.length === 0) push("OBJECTIVE", `step ${index} has an empty zone`);
        for (const p of step.zone) onBoard(map, p, `step ${index} zone tile`, push);
        // Arriving counts as the first check and the step completes once the count
        // exceeds `holdRounds` (objectives/steps.ts), so the final state holds one more.
        if (step.roundsHeld < 0 || step.roundsHeld > step.holdRounds + 1) {
          push("OBJECTIVE", `step ${index} held ${step.roundsHeld} of ${step.holdRounds}`);
        }
        if (step.requireItem !== undefined && !KNOWN_ITEMS.has(step.requireItem)) {
          push("OBJECTIVE", `step ${index} requires unknown item ${step.requireItem}`);
        }
        break;
      case "acquire_item":
        if (!KNOWN_ITEMS.has(step.itemType))
          push("OBJECTIVE", `step ${index} wants unknown item ${step.itemType}`);
        break;
      case "survive_rounds":
        if (step.roundsSurvived < 0 || step.roundsSurvived > step.rounds) {
          push("OBJECTIVE", `step ${index} survived ${step.roundsSurvived} of ${step.rounds}`);
        }
        break;
    }
  });
}
