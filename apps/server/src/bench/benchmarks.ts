import {
  advanceUntilPlayerInput,
  bestAudibleNoise,
  checkInvariants,
  createRng,
  findShortestPath,
  fingerprint,
  passabilityFor,
  revealExplored,
  runZombiePhase,
  searchFrom,
  visibilityGrid,
  type GameState,
} from "@zombie/game-core";
import { decodeServerMessage, encodeMessage } from "@zombie/protocol";
import { DEFAULT_CITY_OPTIONS, generateCity } from "@zombie/map-generation";
import { MatchRuntime } from "../match/MatchRuntime.js";
import { redactState } from "../match/redact.js";
import { buildFixtures, endTurnCommand, LARGE_CITY, type Fixture } from "./fixtures.js";
import { measure, type Measurement } from "./measure.js";

/** Every measured case, grouped by what the track asks for. Deterministic inputs throughout. */
export function runBenchmarks(): Measurement[] {
  const fixtures = buildFixtures();
  const rows: Measurement[] = [];
  const note = (f: Fixture) =>
    `${f.state.map.width}x${f.state.map.height}, ${f.state.zombies.length} zombies, ${f.state.noises.length} noises`;

  // Procedural generation.
  rows.push(
    measure("generateCity default", () => generateCity({ ...DEFAULT_CITY_OPTIONS, seed: 1 }), {
      note: `${DEFAULT_CITY_OPTIONS.width}x${DEFAULT_CITY_OPTIONS.height}`,
      iterations: 30,
    }),
    measure("generateCity large", () => generateCity({ ...LARGE_CITY, seed: 1 }), {
      note: `${LARGE_CITY.width}x${LARGE_CITY.height}`,
      iterations: 20,
    }),
  );

  // Zombie phase and the whole end of round (zombies, threat, events, objective).
  for (const f of [fixtures.typical, fixtures.heavy, fixtures.large, fixtures.noisy]) {
    rows.push(
      measure(
        `zombie phase ${f.name}`,
        () => runZombiePhase(f.state, createRng(f.state.rngState)),
        { note: note(f) },
      ),
    );
    const atRoundEnd: GameState = { ...f.state, phase: { kind: "zombie_phase" } };
    rows.push(
      measure(`end of round ${f.name}`, () => advanceUntilPlayerInput(atRoundEnd), {
        note: note(f),
      }),
    );
  }

  // Pathfinding: what one zombie does per step (a full-board search), and a long path.
  for (const f of [fixtures.typical, fixtures.large]) {
    const zombie = f.state.zombies[0];
    if (zombie === undefined) throw new Error("fixture without zombies");
    const unlimited = f.state.map.width * f.state.map.height;
    rows.push(
      measure(
        `searchFrom (one zombie, unlimited) ${f.name}`,
        () =>
          searchFrom(
            f.state.map,
            zombie.position,
            unlimited,
            passabilityFor(f.state, { kind: "zombie", id: zombie.id }),
          ),
        { note: `${f.state.map.width}x${f.state.map.height}` },
      ),
    );
    const player = f.state.players[0];
    if (player === undefined) throw new Error("fixture without players");
    const far = f.state.objective.steps.find((s) => s.kind === "reach_location");
    const goal = far?.kind === "reach_location" ? far.zone[0] : undefined;
    if (goal !== undefined) {
      rows.push(
        measure(
          `findShortestPath survivor to extraction ${f.name}`,
          () =>
            findShortestPath(
              f.state.map,
              player.position,
              goal,
              unlimited,
              passabilityFor(f.state, { kind: "survivor", id: player.id }),
            ),
          { note: `${f.state.map.width}x${f.state.map.height}` },
        ),
      );
    }
  }

  // Line of sight and fog of war.
  for (const f of [fixtures.typical, fixtures.large]) {
    rows.push(
      measure(`visibilityGrid ${f.name}`, () => visibilityGrid(f.state), { note: note(f) }),
      measure(`revealExplored ${f.name}`, () => revealExplored(f.state), { note: note(f) }),
    );
  }

  // Noise evaluation: every zombie picks the best audible noise.
  rows.push(
    measure(
      "bestAudibleNoise all zombies noisy",
      () => {
        for (const z of fixtures.noisy.state.zombies) bestAudibleNoise(fixtures.noisy.state, z);
      },
      { note: note(fixtures.noisy) },
    ),
  );

  // Invariants (what the server runs after every accepted command).
  for (const f of [fixtures.heavy, fixtures.large]) {
    rows.push(
      measure(`checkInvariants critical ${f.name}`, () => checkInvariants(f.state, "critical"), {
        note: note(f),
      }),
      measure(`checkInvariants full ${f.name}`, () => checkInvariants(f.state, "full"), {
        note: note(f),
      }),
    );
  }

  // Serialization and payloads.
  for (const f of [fixtures.typical, fixtures.heavy, fixtures.large]) {
    const wire = encodeMessage({
      t: "update",
      revision: 1,
      state: redactState(f.state),
      events: [],
    });
    const full = JSON.stringify(f.state);
    rows.push(
      measure(`redactState ${f.name}`, () => redactState(f.state), { note: note(f) }),
      measure(
        `encode update ${f.name}`,
        () => encodeMessage({ t: "update", revision: 1, state: redactState(f.state), events: [] }),
        { note: `${Buffer.byteLength(wire)} bytes on the wire (redacted, no map)` },
      ),
      measure(`decode update ${f.name}`, () => decodeServerMessage(wire), {
        note: `${Buffer.byteLength(wire)} bytes`,
      }),
      measure(`fingerprint (journal checkpoint) ${f.name}`, () => fingerprint(f.state), {
        note: `${Buffer.byteLength(full)} bytes of full state`,
      }),
    );
  }

  // The server's per-command pipeline: rules, phases, invariants (critical), revision.
  for (const f of [fixtures.typical, fixtures.heavy, fixtures.large]) {
    const command = endTurnCommand(f.state);
    if (command === undefined) continue;
    rows.push(
      measure(
        `runtime.apply end_turn ${f.name}`,
        () => new MatchRuntime(f.state, 0, { invariantLevel: "critical" }).apply(command),
        { note: note(f) },
      ),
    );
  }
  return rows;
}
