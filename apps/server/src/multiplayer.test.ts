import { fingerprint, type GameState } from "@zombie/game-core";
import type { ClientCommand } from "@zombie/protocol";
import { describe, expect, it } from "vitest";
import { decide } from "./soak/botPolicy.js";
import { createServerHarness } from "./testing/harness.js";
import type { ProtocolClient } from "./testing/protocolClient.js";

/**
 * Real server, real sockets, several clients at once: party sizes, the full-match limit,
 * ordering under near-simultaneous input, the whole party leaving, and terminal matches.
 * Single-client protocol behaviour (duplicates, stale revisions, malformed input, single
 * reconnects) is covered in server.test.ts.
 */
const harness = createServerHarness();
const { connect, scheduled } = harness;

describe("party sizes", () => {
  for (const n of [1, 2, 3, 4]) {
    it(`creates, fills, and starts a ${n}-player match where everyone sees the same state`, async () => {
      const match = await harness.matchOf(n);
      expect(match.playerIds).toHaveLength(n);
      expect(new Set(match.playerIds).size).toBe(n);
      const state = harness.registry.get(match.code)?.describe();
      expect(state).toMatchObject({ status: "active", revision: 0, round: 1 });
      expect(state?.players.map((p) => p.connected)).toEqual(Array<boolean>(n).fill(true));
      // The first update reached everyone with identical content (a team shares one view).
      const firstUpdates = await Promise.all(
        match.clients.map(async (c) => {
          c.command({ type: "end_turn" }, { baseRevision: 0 });
          return c.next("update", (m) => m.revision === 1);
        }),
      );
      // Only the active player's end_turn was accepted; everyone got the same revision 1.
      const views = new Set(firstUpdates.map((u) => fingerprint(u.state)));
      expect(views.size).toBe(1);
      expect(firstUpdates.map((u) => u.state.players.length)).toEqual(Array<number>(n).fill(n));
    });
  }

  it("turns away a fifth player and still lets the four start", async () => {
    const lobby = await harness.lobbyOf(4);
    const fifth = await connect();
    fifth.send({ t: "join_match", matchCode: lobby.code, playerName: "Fifth" });
    expect((await fifth.next("error")).code).toBe("MATCH_FULL");
    await fifth.expectNone("joined");
    lobby.clients[0]?.send({ t: "start_match" });
    const updates = await Promise.all(lobby.clients.map((c) => c.next("update")));
    expect(updates.map((u) => u.state.players.length)).toEqual([4, 4, 4, 4]);
    await fifth.expectNone("update");
    expect(harness.registry.get(lobby.code)?.describe().players).toHaveLength(4);
  });

  it("refuses to join a match that has started, even with a free slot", async () => {
    const match = await harness.matchOf(2);
    const late = await connect();
    late.send({ t: "join_match", matchCode: match.code, playerName: "Late" });
    expect((await late.next("error")).code).toBe("MATCH_ALREADY_STARTED");
  });
});

describe("ordering under simultaneous input", () => {
  it("accepts exactly one command per revision and delivers the same sequence to every client", async () => {
    const { clients, playerIds } = await harness.matchOf(4);
    // Everyone fires an end_turn at the same revision at once. Only the active player's
    // can be accepted; the others are out of turn, whatever order the sockets land in.
    const ids = clients.map((c) => c.command({ type: "end_turn" }, { baseRevision: 0 }));
    const answers = await Promise.all(
      clients.map((c, i) =>
        Promise.race([
          c.next("update", (m) => m.commandId === ids[i]),
          c.next("rejected", (m) => m.commandId === ids[i]),
        ]),
      ),
    );
    const accepted = answers.filter((a) => a.t === "update");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.revision).toBe(1);
    // The other three lose either way: processed before the winner they are out of turn,
    // after it they are stale (the revision check comes first). Never a second acceptance.
    const reasons = answers.flatMap((a) => (a.t === "rejected" ? [a.reason] : []));
    expect(reasons).toHaveLength(3);
    expect(reasons.every((r) => r === "INVALID_PHASE" || r === "STALE_REVISION")).toBe(true);
    // The round then proceeds in turn order through the rest of the party.
    const turnOrder = [playerIds[0]];
    for (let revision = 1; revision < 4; revision += 1) {
      const active = await Promise.all(
        clients.map((c, i) => {
          // The accepted player's revision-1 update was consumed by the race above.
          const already = answers[i];
          if (revision === 1 && already?.t === "update") return Promise.resolve(already);
          return c.next("update", (m) => m.revision === revision);
        }),
      );
      const phases = active.map((u) => u.state.phase);
      const fingerprints = new Set(active.map((u) => fingerprint(u.state)));
      expect(fingerprints.size).toBe(1);
      const phase = phases[0];
      if (phase?.kind !== "player_turn") throw new Error(`unexpected phase ${String(phase?.kind)}`);
      turnOrder.push(phase.activePlayerId);
      const next = clients[playerIds.indexOf(phase.activePlayerId)];
      if (next === undefined) throw new Error("active player has no client");
      next.command({ type: "end_turn" }, { baseRevision: revision });
    }
    expect(turnOrder).toEqual(playerIds);
    // The last end_turn ran the zombie phase and started round 2 for everyone.
    const round2 = await Promise.all(clients.map((c) => c.next("update", (m) => m.revision === 4)));
    expect(round2.map((u) => u.state.round)).toEqual([2, 2, 2, 2]);
    expect(new Set(round2.map((u) => fingerprint(u.state))).size).toBe(1);
  });

  it("keeps revisions strictly increasing per client while a teammate reconnects mid-turn", async () => {
    const { clients, code, tokens } = await harness.matchOf(3);
    const [a, b, c] = clients as [ProtocolClient, ProtocolClient, ProtocolClient];
    const seen: number[] = [];
    // The active player moves; at the same moment a teammate drops and returns.
    const moveId = a.command({ type: "end_turn" }, { baseRevision: 0 });
    const gone1 = harness.nextDisconnect();
    await c.terminate();
    await gone1;
    const back = await connect();
    back.send({ t: "rejoin_match", matchCode: code, rejoinToken: tokens[2] ?? "" });
    expect(await back.next("joined")).toMatchObject({ rejoined: true, matchStarted: true });
    await back.next("map");
    // b sees every revision exactly once, in order, whatever interleaving happened.
    for (let i = 0; i < 3; i += 1) seen.push((await b.next("update")).revision);
    expect(seen).toEqual([1, 2, 3]);
    await a.next("update", (m) => m.commandId === moveId);
    const snapshot = await back.next("update");
    expect(snapshot.revision).toBe(3);
    expect(snapshot.state.players[2]?.present).toBe(true);
  });
});

describe("whole-party disconnect", () => {
  it("keeps a started match through the grace period and forgets it afterwards", async () => {
    const { clients, code, tokens } = await harness.matchOf(2);
    const bothGone = harness.nextDisconnect(2);
    await Promise.all(clients.map((c) => c.terminate()));
    await bothGone;
    // Still there: everyone may come back within the grace period.
    expect(
      harness.registry
        .get(code)
        ?.describe()
        .players.map((p) => p.connected),
    ).toEqual([false, false]);
    expect(scheduled).toHaveLength(1);
    const back = await connect();
    back.send({ t: "rejoin_match", matchCode: code, rejoinToken: tokens[1] ?? "" });
    expect(await back.next("joined")).toMatchObject({ rejoined: true });
    await back.next("map");
    const snapshot = await back.next("update");
    // The returning player holds the turn: the absent host cannot.
    expect(snapshot.state.phase).toMatchObject({
      kind: "player_turn",
      activePlayerId: snapshot.state.players[1]?.id,
    });
    // Their return cancelled the abandonment timer.
    expect(scheduled).toHaveLength(0);

    const gone2 = harness.nextDisconnect();
    await back.terminate();
    await gone2;
    expect(scheduled).toHaveLength(1);
    scheduled[0]?.();
    expect(harness.registry.get(code)).toBeUndefined();
    const tooLate = await connect();
    tooLate.send({ t: "rejoin_match", matchCode: code, rejoinToken: tokens[0] ?? "" });
    expect((await tooLate.next("error")).code).toBe("MATCH_NOT_FOUND");
  });
});

describe("terminal matches", () => {
  it("refuses gameplay commands after the match ends and still serves the final snapshot on rejoin", async () => {
    const { clients, code, tokens } = await harness.matchOf(1);
    const [solo] = clients as [ProtocolClient];
    const match = harness.registry.get(code);
    if (match === undefined) throw new Error("no match");
    // Play the greedy bot policy over the socket until the match ends (win or lose).
    solo.send({ t: "resync" });
    const map = (await solo.next("map")).map;
    let update = await solo.next("update");
    for (let guard = 0; update.state.phase.kind !== "finished"; guard += 1) {
      if (guard > 500) throw new Error("match did not end");
      const state: GameState = { ...update.state, map };
      const me = state.players[0];
      if (me === undefined) throw new Error("no player");
      const { playerId: _playerId, ...command } = decide(state, me);
      const id = solo.command(command as ClientCommand, { baseRevision: update.revision });
      const answer = await Promise.race([
        solo.next("update", (m) => m.commandId === id),
        solo.next("rejected", (m) => m.commandId === id),
      ]);
      if (answer.t === "update") {
        update = answer;
        continue;
      }
      const end = solo.command({ type: "end_turn" }, { baseRevision: update.revision });
      update = await solo.next("update", (m) => m.commandId === end);
    }
    const finalState = update.state;
    expect(finalState.phase.kind).toBe("finished");
    expect(match.getStatus()).toBe("completed");

    const commandId = solo.command({ type: "end_turn" }, { baseRevision: solo.revision });
    const rejected = await solo.next("rejected", (m) => m.commandId === commandId);
    expect(rejected).toMatchObject({ reason: "INVALID_PHASE", detail: "MATCH_FINISHED" });
    expect(match.describe().revision).toBe(solo.revision);

    const gone3 = harness.nextDisconnect();
    await solo.terminate();
    await gone3;
    const back = await connect();
    back.send({ t: "rejoin_match", matchCode: code, rejoinToken: tokens[0] ?? "" });
    expect(await back.next("joined")).toMatchObject({ rejoined: true, matchStarted: true });
    await back.next("map");
    const snapshot = await back.next("update");
    expect(snapshot.state.phase).toEqual(finalState.phase);
    const again = back.command(
      { type: "move", to: { x: 1, y: 1 } },
      { baseRevision: snapshot.revision },
    );
    expect(await back.next("rejected", (m) => m.commandId === again)).toMatchObject({
      reason: "INVALID_PHASE",
      detail: "MATCH_FINISHED",
    });
  });
});
