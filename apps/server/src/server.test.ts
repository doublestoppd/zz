import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SMALL_TEST_MAP, zombieId } from "@zombie/game-core";
import { encodeMessage, PROTOCOL_VERSION } from "@zombie/protocol";
import { SIMULATION_VERSION } from "@zombie/game-core";
import { GAME_VERSION } from "./version.js";
import { ProtocolClient } from "./testing/protocolClient.js";
import { describe, expect, it } from "vitest";
import { createServerHarness } from "./testing/harness.js";

const harness = createServerHarness();
const { connect, restartWith, nextDisconnect, scheduled } = harness;

/** Creates a two-player lobby with `host` as host and returns both clients plus the code. */
async function twoPlayerLobby() {
  const host = await connect();
  host.send({ t: "create_match", playerName: "Host" });
  const joined = await host.next("joined");
  const guest = await connect();
  guest.send({ t: "join_match", matchCode: joined.matchCode, playerName: "Guest" });
  const guestJoined = await guest.next("joined");
  await host.next("lobby", (m) => m.players.length === 2);
  await guest.next("lobby", (m) => m.players.length === 2);
  return {
    host,
    guest,
    code: joined.matchCode,
    hostId: joined.playerId,
    hostToken: joined.rejoinToken,
    guestId: guestJoined.playerId,
  };
}
describe("lobby", () => {
  it("creates a match, joins by code, and starts on the host's request", async () => {
    const { host, guest, hostId } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    const [hostUpdate, guestUpdate] = await Promise.all([
      host.next("update"),
      guest.next("update"),
    ]);
    expect(hostUpdate.state).toEqual(guestUpdate.state);
    expect(hostUpdate.state.players.map((p) => p.name)).toEqual(["Host", "Guest"]);
    expect(hostUpdate.state.phase).toEqual({ kind: "player_turn", activePlayerId: hostId });
  });

  it("hides zombies out of sight from the snapshot and their events", async () => {
    const { host, guest } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    const [first] = await Promise.all([host.next("update"), guest.next("update")]);
    // The fixture spawns three zombies; from the spawn column not all are in view.
    expect(first.state.zombies.length).toBeLessThan(SMALL_TEST_MAP.zombieSpawns.length);
    expect(first.state.explored.flat().some((known) => !known)).toBe(true);
    host.command({ type: "end_turn" });
    await Promise.all([host.next("update"), guest.next("update")]);
    guest.command({ type: "end_turn" });
    const [after] = await Promise.all([host.next("update"), guest.next("update")]);
    for (const e of after.events) {
      if (e.type === "zombie_moved") {
        expect(after.state.zombies.some((z) => z.id === e.zombieId)).toBe(true);
      }
    }
  });

  it("carries a chosen specialty into the lobby list and the match state", async () => {
    const host = await connect();
    host.send({ t: "create_match", playerName: "Host", specialty: "athlete" });
    const joined = await host.next("joined");
    const lobby = await host.next("lobby");
    expect(lobby.players[0]?.specialty).toBe("athlete");
    host.send({ t: "set_specialty", specialty: "paramedic" });
    expect((await host.next("lobby")).players[0]?.specialty).toBe("paramedic");
    const guest = await connect();
    guest.send({ t: "join_match", matchCode: joined.matchCode, playerName: "Guest" });
    await guest.next("joined");
    await host.next("lobby", (m) => m.players.length === 2);
    host.send({ t: "start_match" });
    const update = await host.next("update");
    expect(update.state.players.map((p) => p.specialty)).toEqual(["paramedic", "survivor"]);
    host.send({ t: "set_specialty", specialty: "officer" });
    expect((await host.next("error")).code).toBe("MATCH_ALREADY_STARTED");
  });

  it("refuses start from a non-host and reports unknown codes", async () => {
    const { guest } = await twoPlayerLobby();
    guest.send({ t: "start_match" });
    expect((await guest.next("error")).code).toBe("NOT_HOST");

    const stranger = await connect();
    stranger.send({ t: "join_match", matchCode: "ZZZZ", playerName: "Nobody" });
    expect((await stranger.next("error")).code).toBe("MATCH_NOT_FOUND");
  });

  it("answers malformed input with an error and keeps the connection", async () => {
    const client = await connect();
    client.sendRaw("{not json");
    expect((await client.next("error")).code).toBe("MALFORMED_MESSAGE");
    client.send({ t: "create_match", playerName: "Still here" });
    await client.next("joined");
  });

  it("rejects invalid names", async () => {
    const client = await connect();
    client.send({ t: "create_match", playerName: "   " });
    expect((await client.next("error")).code).toBe("INVALID_PLAYER_NAME");
  });
});

describe("map delivery", () => {
  it("sends the map once before the first update and never inside updates", async () => {
    const { host, guest, code, hostToken } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    const [map, update] = await Promise.all([host.next("map"), host.next("update")]);
    await guest.next("update");
    expect(map.map.width).toBeGreaterThan(0);
    expect("map" in update.state).toBe(false);

    host.command({ type: "end_turn" });
    const next = await guest.next("update");
    expect("map" in next.state).toBe(false);
    await host.expectNone("map");

    // A rejoining socket gets the map again before its snapshot.
    await host.close();
    await guest.next("update");
    const again = await connect();
    again.send({ t: "rejoin_match", matchCode: code, rejoinToken: hostToken });
    await again.next("joined");
    expect((await again.next("map")).map).toEqual(map.map);
    expect("map" in (await again.next("update")).state).toBe(false);
  });
});

describe("gameplay", () => {
  it("broadcasts accepted moves to everyone and rejections to the sender only", async () => {
    const { host, guest, hostId } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    await Promise.all([host.next("update"), guest.next("update")]);

    guest.command({ type: "end_turn" });
    expect(await guest.next("rejected")).toMatchObject({
      t: "rejected",
      reason: "INVALID_PHASE",
      detail: "NOT_YOUR_TURN",
    });
    await host.expectNone("rejected");
    await host.expectNone("update");

    host.command({ type: "move", to: { x: 2, y: 1 } });
    const [a, b] = await Promise.all([host.next("update"), guest.next("update")]);
    expect(a.revision).toBe(1);
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual([
      { type: "player_moved", playerId: hostId, path: [{ x: 2, y: 1 }], actionPointsSpent: 1 },
    ]);
    expect(a.state.players[0]?.position).toEqual({ x: 2, y: 1 });
  });

  it("runs the zombie phase on the server after the last turn ends", async () => {
    const { host, guest } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    const [first] = await Promise.all([host.next("update"), guest.next("update")]);
    // Zombies out of sight are redacted; the counter still says how many were spawned.
    expect(first.state.zombieCounter).toBe(SMALL_TEST_MAP.zombieSpawns.length);

    host.command({ type: "end_turn" });
    await Promise.all([host.next("update"), guest.next("update")]);
    guest.command({ type: "end_turn" });
    const [after] = await Promise.all([host.next("update"), guest.next("update")]);
    expect(after.state.round).toBe(2);
    // Zombies out of sight and earshot stay put, so the phase itself is the evidence.
    expect(
      after.events.some((e) => e.type === "phase_changed" && e.phase.kind === "zombie_phase"),
    ).toBe(true);
  });

  it("applies fire and reload commands from the active player", async () => {
    const { host, guest } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    await Promise.all([host.next("update"), guest.next("update")]);

    // No zombie is in range at the spawn, so the shot is rejected with a combat reason.
    host.command({ type: "fire_weapon", targetId: zombieId("z1") });
    expect(await host.next("rejected")).toMatchObject({
      reason: "INVALID_ACTION",
      detail: "OUT_OF_RANGE",
    });

    // Reloading a full magazine is rejected too; the state is unchanged for everyone.
    host.command({ type: "reload" });
    expect(await host.next("rejected")).toMatchObject({
      reason: "INVALID_ACTION",
      detail: "MAGAZINE_FULL",
    });
    await guest.expectNone("update");
  });

  it("starts with ground loot rolled from the seed", async () => {
    const { host, guest } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    const [first, second] = await Promise.all([host.next("update"), guest.next("update")]);
    expect(first.state.items).toHaveLength(2);
    expect(first.state.items).toEqual(second.state.items);
    host.command({ type: "pick_up", itemId: first.state.items[0]!.id });
    expect(await host.next("rejected")).toMatchObject({
      reason: "INVALID_ACTION",
      detail: "ITEM_NOT_HERE",
    });
  });

  it("validates searches on the server and never takes loot from the client", async () => {
    const { host, guest } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    const [first] = await Promise.all([host.next("update"), guest.next("update")]);
    expect(first.state.containers).toHaveLength(1);
    const container = first.state.containers[0]!;
    // The host spawns far from the fixture's container.
    host.command({ type: "search", containerId: container.id });
    expect((await host.next("rejected")).detail).toBe("CONTAINER_OUT_OF_REACH");
    await guest.expectNone("update");
  });

  it("ignores any playerId a client tries to smuggle in", async () => {
    const { host, guest, hostId } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    await Promise.all([host.next("update"), guest.next("update")]);
    guest.sendRaw(
      encodeMessage({
        t: "command",
        commandId: "smuggle",
        baseRevision: 0,
        command: { type: "end_turn", playerId: hostId },
      }),
    );
    expect(await guest.next("rejected")).toMatchObject({
      commandId: "smuggle",
      reason: "INVALID_PHASE",
      detail: "NOT_YOUR_TURN",
    });
  });
});

describe("http side", () => {
  it("answers the health check and serves the client from a static directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zombie-static-"));
    writeFileSync(join(dir, "index.html"), "<h1>ok</h1>");
    writeFileSync(join(dir, "app.js"), "console.log(1)");
    await restartWith({ staticDir: dir });
    const base = `http://127.0.0.1:${harness.handle.port}`;
    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
    const index = await fetch(`${base}/`);
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(await index.text()).toBe("<h1>ok</h1>");
    expect((await fetch(`${base}/app.js`)).headers.get("content-type")).toContain("javascript");
    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
    expect((await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`)).status).not.toBe(200);
  });

  it("exposes metrics and, behind the admin token, match diagnostics without tokens", async () => {
    const diagnostics = harness.registry.diagnostics();
    await restartWith({
      http: {
        metricsText: () => harness.registry.metricsText(),
        adminToken: "s3cret",
        diagnostics,
        isReady: diagnostics.isReady,
      },
    });
    const { host, guest, code } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    await Promise.all([host.next("update"), guest.next("update")]);
    host.command({ type: "move", to: { x: 2, y: 1 } });
    await Promise.all([host.next("update"), guest.next("update")]);
    guest.command({ type: "end_turn" });
    await guest.next("rejected");
    const base = `http://127.0.0.1:${harness.handle.port}`;
    const text = await (await fetch(`${base}/metrics`)).text();
    expect(text).toContain('zombie_commands_total{outcome="accepted"}');
    expect(text).toContain('zombie_commands_total{outcome="rejected",reason="INVALID_PHASE"}');
    expect(text).toContain("zombie_snapshot_bytes_count");
    expect(text).toContain("zombie_active_matches 1");
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
    // No token, wrong token: the endpoints do not exist.
    expect((await fetch(`${base}/admin/matches`)).status).toBe(404);
    expect(
      (await fetch(`${base}/admin/matches`, { headers: { authorization: "Bearer nope" } })).status,
    ).toBe(404);
    const auth = { headers: { authorization: "Bearer s3cret" } };
    const list = (await (await fetch(`${base}/admin/matches`, auth)).json()) as {
      code: string;
      revision: number;
      status: string;
    }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ code, status: "active", revision: 1 });
    const detailText = await (await fetch(`${base}/admin/matches/${code}`, auth)).text();
    expect(detailText).not.toContain("token-");
    expect(JSON.parse(detailText)).toMatchObject({
      code,
      round: 1,
      phase: "player_turn",
      journalEntries: 1,
    });
    expect((await fetch(`${base}/admin/matches/ZZZZ`, auth)).status).toBe(404);
  });

  it("serves only the health check when no static directory is configured", async () => {
    const base = `http://127.0.0.1:${harness.handle.port}`;
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/`)).status).toBe(404);
  });
});

describe("socket limits", () => {
  it("drops messages over the rate limit and closes a client that keeps flooding", async () => {
    await restartWith({ rateLimit: { burst: 3, perSecond: 1 } });
    const client = await connect();
    for (let i = 0; i < 4; i += 1) client.send({ t: "start_match" });
    expect((await client.next("error", (m) => m.code === "RATE_LIMITED")).code).toBe(
      "RATE_LIMITED",
    );
    for (let i = 0; i < 6; i += 1) client.send({ t: "start_match" });
    expect(await client.closed).toBe(1008);
  });

  it("closes a socket that sends an oversized frame", async () => {
    await restartWith({ maxPayloadBytes: 256 });
    const client = await connect();
    client.sendRaw("x".repeat(1024));
    expect(await client.closed).toBe(1009);
  });

  it("pings connected clients on the configured interval", async () => {
    await restartWith({ pingIntervalMs: 30 });
    const client = await connect();
    await new Promise((r) => setTimeout(r, 120));
    expect(client.pings).toBeGreaterThanOrEqual(2);
  });
});

describe("command reliability", () => {
  it("accepts a command once and answers a retransmission as a duplicate without acting", async () => {
    const { host, guest, hostId } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    await Promise.all([host.next("update"), guest.next("update")]);

    const id = host.command({ type: "move", to: { x: 2, y: 1 } }, { commandId: "move-1" });
    const [moved, seen] = await Promise.all([host.next("update"), guest.next("update")]);
    expect(moved.revision).toBe(1);
    expect(moved.commandId).toBe(id);
    expect(seen.commandId).toBe(id);

    // Same id again (a retransmission): refused, nothing applied, nobody else hears about it.
    host.command({ type: "move", to: { x: 3, y: 1 } }, { commandId: "move-1" });
    expect(await host.next("rejected")).toMatchObject({
      commandId: "move-1",
      reason: "DUPLICATE_COMMAND",
      currentRevision: 1,
    });
    await guest.expectNone("update");

    // A fresh id composed against the old revision: stale, still nothing applied.
    host.command({ type: "move", to: { x: 3, y: 1 } }, { commandId: "move-2", baseRevision: 0 });
    expect(await host.next("rejected")).toMatchObject({
      commandId: "move-2",
      reason: "STALE_REVISION",
      currentRevision: 1,
    });
    await guest.expectNone("update");

    // The stale client asks for a snapshot and gets the board plus the latest revision.
    host.send({ t: "resync" });
    await host.next("map");
    const snapshot = await host.next("update");
    expect(snapshot.revision).toBe(1);
    expect(snapshot.commandId).toBeUndefined();
    await guest.expectNone("update");

    // A correct command now succeeds and is the very next update everyone sees.
    host.command({ type: "end_turn" }, { commandId: "end-1" });
    const [a, b] = await Promise.all([host.next("update"), guest.next("update")]);
    expect(a.revision).toBe(2);
    expect(b.state.players.find((p) => p.id === hostId)?.position).toEqual({ x: 2, y: 1 });
  });

  it("remembers command ids across a reconnect of the same player", async () => {
    const { host, guest, code, hostToken } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    await Promise.all([host.next("update"), guest.next("update")]);
    host.command({ type: "move", to: { x: 2, y: 1 } }, { commandId: "before-drop" });
    await Promise.all([host.next("update"), guest.next("update")]);
    await host.close();
    await guest.next("update"); // presence change

    const again = await connect();
    again.send({ t: "rejoin_match", matchCode: code, rejoinToken: hostToken });
    await again.next("joined");
    const snapshot = await again.next("update");
    again.revision = snapshot.revision;
    again.command({ type: "move", to: { x: 3, y: 1 } }, { commandId: "before-drop" });
    expect((await again.next("rejected")).reason).toBe("DUPLICATE_COMMAND");
    // A new id from the new socket is judged on its merits: the turn passed while away.
    again.command({ type: "end_turn" }, { commandId: "after-drop" });
    expect(await again.next("rejected")).toMatchObject({
      commandId: "after-drop",
      reason: "INVALID_PHASE",
      detail: "NOT_YOUR_TURN",
    });
  });

  it("answers a malformed command body per command and a broken envelope per session", async () => {
    const { host, guest } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    await Promise.all([host.next("update"), guest.next("update")]);
    host.sendRaw(
      '{"t":"command","commandId":"bad-body","baseRevision":0,"command":{"type":"move","to":"there"}}',
    );
    expect(await host.next("rejected")).toMatchObject({
      commandId: "bad-body",
      reason: "MALFORMED_COMMAND",
    });
    host.sendRaw('{"t":"command","baseRevision":0,"command":{"type":"end_turn"}}');
    expect((await host.next("error")).code).toBe("MALFORMED_MESSAGE");
    host.sendRaw("not json");
    expect((await host.next("error")).code).toBe("MALFORMED_MESSAGE");
    await guest.expectNone("update");
    // The revision did not move: a correct command still applies against revision 0.
    host.command({ type: "end_turn" });
    expect((await host.next("update")).revision).toBe(1);
  });

  it("refuses commands from sockets that are not in a match or whose match has not started", async () => {
    const stranger = await connect();
    stranger.command({ type: "end_turn" });
    expect((await stranger.next("error")).code).toBe("NOT_IN_MATCH");
    const { host } = await twoPlayerLobby();
    host.command({ type: "end_turn" }, { commandId: "early" });
    expect(await host.next("rejected")).toMatchObject({
      commandId: "early",
      reason: "MATCH_NOT_STARTED",
    });
  });

  it("classifies out-of-turn and rule rejections and reports the current revision", async () => {
    const { host, guest } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    await Promise.all([host.next("update"), guest.next("update")]);
    guest.command({ type: "end_turn" }, { commandId: "not-my-turn" });
    expect(await guest.next("rejected")).toMatchObject({
      commandId: "not-my-turn",
      reason: "INVALID_PHASE",
      detail: "NOT_YOUR_TURN",
      currentRevision: 0,
    });
    host.command({ type: "reload" }, { commandId: "full" });
    expect(await host.next("rejected")).toMatchObject({
      reason: "INVALID_ACTION",
      detail: "MAGAZINE_FULL",
      currentRevision: 0,
    });
  });
});

/** The id of the second player in a snapshot (the guest of `twoPlayerLobby`). */
function guestId(update: { state: { players: readonly { id: string }[] } }): string {
  return update.state.players[1]!.id;
}

describe("presence", () => {
  it("marks a disconnected player absent, passes the turn, and lets them rejoin", async () => {
    const { host, guest, code, hostId, hostToken, guestId } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    await Promise.all([host.next("update"), guest.next("update")]);

    // The host (active) drops. The guest should now hold the turn.
    await host.close();
    const afterDrop = await guest.next("update");
    expect(afterDrop.state.players.find((p) => p.id === hostId)?.present).toBe(false);
    expect(afterDrop.state.phase).toEqual({ kind: "player_turn", activePlayerId: guestId });

    // Rejoin with the token: present again, latest snapshot delivered.
    const returning = await connect();
    returning.send({ t: "rejoin_match", matchCode: code, rejoinToken: hostToken });
    expect((await returning.next("joined")).playerId).toBe(hostId);
    const snapshot = await returning.next("update");
    expect(snapshot.state.players.find((p) => p.id === hostId)?.present).toBe(true);
    expect(snapshot.state.phase).toEqual({ kind: "player_turn", activePlayerId: guestId });
  });

  it("restores the same survivor, untouched, when the active player refreshes mid-turn", async () => {
    const { host, guest, code, hostId, hostToken } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    await Promise.all([host.next("update"), guest.next("update")]);
    host.command({ type: "move", to: { x: 2, y: 1 } });
    const [moved] = await Promise.all([host.next("update"), guest.next("update")]);
    const before = moved.state.players.find((p) => p.id === hostId)!;

    await host.close();
    const dropped = await guest.next("update"); // turn passes to the guest at once
    expect(dropped.state.phase).toEqual({ kind: "player_turn", activePlayerId: guestId(dropped) });

    const back = await connect();
    back.send({ t: "rejoin_match", matchCode: code, rejoinToken: hostToken });
    const joined = await back.next("joined");
    expect(joined).toMatchObject({ playerId: hostId, rejoined: true, matchStarted: true });
    await back.next("map");
    const snapshot = await back.next("update");
    const after = snapshot.state.players.find((p) => p.id === hostId)!;
    // Same slot, same body: position, action points, health, inventory, ammunition.
    expect({ ...after, present: true }).toEqual({ ...before, present: true });
    expect(snapshot.state.players).toHaveLength(2);
    expect(snapshot.revision).toBe(dropped.revision + 1); // the presence change is a mutation
    // The turn does not come back mid-round; the host acts again next round.
    back.revision = snapshot.revision;
    back.command({ type: "end_turn" });
    expect((await back.next("rejected")).detail).toBe("NOT_YOUR_TURN");
  });

  it("reconnects after a zombie phase and after the match has finished", async () => {
    const { host, guest, code, hostToken } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    await Promise.all([host.next("update"), guest.next("update")]);
    host.command({ type: "end_turn" });
    await Promise.all([host.next("update"), guest.next("update")]);
    await host.close();
    await guest.next("update");
    // The guest ends the round while the host is away: the zombie phase runs without them.
    guest.command({ type: "end_turn" });
    const round2 = await guest.next("update");
    expect(round2.state.round).toBe(2);

    const back = await connect();
    back.send({ t: "rejoin_match", matchCode: code, rejoinToken: hostToken });
    await back.next("joined");
    await back.next("map");
    const snapshot = await back.next("update");
    expect(snapshot.state.round).toBe(2);
    expect(snapshot.state.phase.kind).toBe("player_turn");

    // A finished match still answers a rejoin with its final snapshot and refuses commands.
    const solo = await connect();
    solo.send({ t: "create_match", playerName: "Solo" });
    const soloJoined = await solo.next("joined");
    solo.send({ t: "start_match" });
    await solo.next("update");
    await solo.close();
    const again = await connect();
    again.send({
      t: "rejoin_match",
      matchCode: soloJoined.matchCode,
      rejoinToken: soloJoined.rejoinToken,
    });
    await again.next("joined");
    await again.next("map");
    expect((await again.next("update")).state.players[0]?.present).toBe(true);
  });

  it("tells a superseded socket it was replaced and closes it", async () => {
    const { host, code, hostToken } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    await host.next("update");
    const secondTab = await connect();
    secondTab.send({ t: "rejoin_match", matchCode: code, rejoinToken: hostToken });
    await secondTab.next("joined");
    expect((await host.next("error")).code).toBe("SESSION_REPLACED");
    expect(await host.closed).toBe(1008);
    // The new socket owns the slot: its commands get gameplay answers, not NOT_IN_MATCH.
    secondTab.revision = (await secondTab.next("update")).revision;
    secondTab.command({ type: "reload" });
    expect((await secondTab.next("rejected")).detail).toBe("MAGAZINE_FULL");
  });

  it("rejects bad rejoin tokens", async () => {
    const { host, code } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    await host.next("update");
    const stranger = await connect();
    stranger.send({ t: "rejoin_match", matchCode: code, rejoinToken: "nope" });
    expect((await stranger.next("error")).code).toBe("INVALID_REJOIN_TOKEN");
  });

  it("drops an empty lobby immediately and an abandoned match after the grace period", async () => {
    const lonely = await connect();
    lonely.send({ t: "create_match", playerName: "Solo" });
    await lonely.next("joined");
    expect(harness.registry.size()).toBe(1);
    const gone = nextDisconnect();
    await lonely.close();
    await gone;
    expect(harness.registry.size()).toBe(0);

    const player = await connect();
    player.send({ t: "create_match", playerName: "Solo" });
    await player.next("joined");
    player.send({ t: "start_match" });
    await player.next("update");
    const left = nextDisconnect();
    await player.close();
    await left;
    expect(harness.registry.size()).toBe(1);
    expect(scheduled).toHaveLength(1);
    scheduled.splice(0).forEach((fire) => {
      fire();
    });
    expect(harness.registry.size()).toBe(0);
  });
});

describe("build identity", () => {
  it("serves the build identity at /version when configured", async () => {
    await restartWith({
      http: {
        version: () => ({
          gameVersion: GAME_VERSION,
          protocolVersion: PROTOCOL_VERSION,
          simulationVersion: SIMULATION_VERSION,
          sourceRevision: "abc123",
        }),
      },
    });
    const answer = await fetch(`http://127.0.0.1:${harness.handle.port}/version`);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      gameVersion: GAME_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      simulationVersion: SIMULATION_VERSION,
      sourceRevision: "abc123",
    });
  });
});

describe("version handshake", () => {
  it("welcomes a client with the same protocol version and reports the server's versions", async () => {
    const raw = await ProtocolClient.connect(harness.handle.port, { handshake: false });
    raw.send({ t: "hello", protocolVersion: PROTOCOL_VERSION, gameVersion: "test-build" });
    expect(await raw.next("welcome")).toEqual({
      t: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      gameVersion: GAME_VERSION,
      simulationVersion: SIMULATION_VERSION,
    });
    raw.send({ t: "create_match", playerName: "Ann" });
    expect((await raw.next("joined")).matchCode).toHaveLength(4);
    await raw.close();
  });

  it("refuses another protocol version with the refresh text and closes the socket", async () => {
    const old = await ProtocolClient.connect(harness.handle.port, { handshake: false });
    old.send({ t: "hello", protocolVersion: PROTOCOL_VERSION - 1, gameVersion: "0.0.1" });
    const error = await old.next("error");
    expect(error.code).toBe("VERSION_MISMATCH");
    expect(error.message).toBe("The game has been updated. Refresh to continue.");
    expect(await old.closed).toBe(1008);
  });

  it("treats any message before hello as a client from before the handshake", async () => {
    const legacy = await ProtocolClient.connect(harness.handle.port, { handshake: false });
    legacy.send({ t: "create_match", playerName: "Old" });
    expect((await legacy.next("error")).code).toBe("VERSION_MISMATCH");
    expect(await legacy.closed).toBe(1008);
    await legacy.expectNone("joined").catch(() => undefined);
  });
});
