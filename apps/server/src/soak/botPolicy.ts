import {
  barrierOptions,
  currentStep,
  findShortestPath,
  legalFireTargets,
  legalMeleeTargets,
  legalMoveDestinations,
  passabilityFor,
  positionsEqual,
  stepZone,
  validateReload,
  chebyshevDistance,
  type Command,
  type GameState,
  type PlayerState,
  type Position,
} from "@zombie/game-core";

/**
 * A plain, greedy survivor: shoot what is close, reload when empty, otherwise walk toward
 * the current objective (opening or forcing doors in the way), then end the turn. Not
 * clever, so its results are a floor: humans should do better than this.
 */
export function decide(state: GameState, me: PlayerState): Command {
  const near = legalFireTargets(state, me).filter(
    (z) => chebyshevDistance(z.position, me.position) <= 2,
  );
  const target = near[0];
  if (target !== undefined) return { type: "fire_weapon", playerId: me.id, targetId: target.id };
  const adjacent = legalMeleeTargets(state, me)[0];
  if (adjacent !== undefined && me.weapon.loadedAmmo === 0) {
    return { type: "melee_attack", playerId: me.id, targetId: adjacent.id };
  }
  if (me.weapon.loadedAmmo === 0 && validateReload(state, me).ok) {
    return { type: "reload", playerId: me.id };
  }
  const goal = goalFor(state, me);
  if (goal !== undefined) {
    const passable = passabilityFor(state, { kind: "survivor", id: me.id });
    const path = findShortestPath(state.map, me.position, goal, 500, passable);
    if (path !== undefined) {
      const legal = legalMoveDestinations(state, me.id);
      let dest: Position | undefined;
      for (const step of path) if (legal.some((l) => positionsEqual(l, step))) dest = step;
      if (dest !== undefined) return { type: "move", playerId: me.id, to: dest };
    } else {
      const doors = barrierOptions(state, me);
      const door = doors.open[0] ?? doors.force[0];
      if (door !== undefined) {
        return {
          type: doors.open[0] !== undefined ? "open_door" : "force_entry",
          playerId: me.id,
          barrierId: door.id,
        };
      }
      // Walk to whichever reachable tile is closest to the goal.
      const legal = legalMoveDestinations(state, me.id);
      const best = legal.reduce<Position | undefined>(
        (b, p) =>
          b === undefined || chebyshevDistance(p, goal) < chebyshevDistance(b, goal) ? p : b,
        undefined,
      );
      if (
        best !== undefined &&
        chebyshevDistance(best, goal) < chebyshevDistance(me.position, goal)
      ) {
        return { type: "move", playerId: me.id, to: best };
      }
    }
  }
  return { type: "end_turn", playerId: me.id };
}

function goalFor(state: GameState, me: PlayerState): Position | undefined {
  const step = currentStep(state.objective);
  if (step === undefined) return undefined;
  if (step.kind === "acquire_item") {
    const item = state.items.find((i) => i.type === step.itemType);
    return item?.position;
  }
  const zone = stepZone(step);
  if (zone.some((p) => positionsEqual(p, me.position))) return undefined;
  const free = zone.filter(
    (p) => !state.players.some((o) => o.id !== me.id && positionsEqual(o.position, p)),
  );
  // Fill the back of the zone first so late arrivals are not walled out by teammates.
  const passable = passabilityFor(state, { kind: "survivor", id: me.id });
  let best: { p: Position; d: number } | undefined;
  for (const p of free) {
    const path = findShortestPath(state.map, me.position, p, 500, passable);
    const d = path === undefined ? -1 : path.length;
    if (best === undefined || d > best.d) best = { p, d };
  }
  return best?.p;
}
