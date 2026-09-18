import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { SMALL_TEST_MAP, zombieId } from "@zombie/game-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decodeServerMessage,
  encodeMessage,
  type ClientCommand,
  type ClientMessage,
  type ServerMessage,
} from "@zombie/protocol";
import { MatchRegistry } from "./lobby/MatchRegistry.js";
import { startSocketServer, type SocketServerHandle } from "./net/socketServer.js";
import { handleClientMessage, handleDisconnect } from "./router.js";

/** A test client that queues every server message so tests can await specific ones. */
class TestClient {
  private readonly received: ServerMessage[] = [];
  private readonly waiters: {
    predicate: (m: ServerMessage) => boolean;
    resolve: (m: ServerMessage) => void;
  }[] = [];

  private constructor(private readonly socket: WebSocket) {
    this.closed = new Promise((resolve) => {
      socket.once("close", (code) => {
        resolve(code);
      });
    });
    socket.on("ping", () => {
      this.pings += 1;
    });
  }

  static connect(port: number): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);
      const client = new TestClient(socket);
      socket.on("message", (data) => {
        const text = Array.isArray(data)
          ? Buffer.concat(data).toString()
          : Buffer.from(data as Buffer).toString();
        const decoded = decodeServerMessage(text);
        if (!decoded.ok) throw new Error(decoded.error);
        client.deliver(decoded.value);
      });
      socket.once("open", () => {
        resolve(client);
      });
      socket.once("error", reject);
    });
  }

  /** Version of the latest `update` seen, whether or not a test has consumed it yet. */
  version = 0;
  pings = 0;
  /** Resolves with the close code once the server closes the socket. */
  readonly closed: Promise<number>;
  private nextSeq = 1;

  send(message: ClientMessage): void {
    this.socket.send(encodeMessage(message));
  }

  /** Sends a gameplay command with the next seq and the latest known version. */
  command(
    command: ClientCommand,
    overrides: { seq?: number; expectedVersion?: number } = {},
  ): number {
    const seq = overrides.seq ?? this.nextSeq;
    this.nextSeq = Math.max(this.nextSeq, seq) + 1;
    this.send({
      t: "command",
      seq,
      expectedVersion: overrides.expectedVersion ?? this.version,
      command,
    });
    return seq;
  }

  sendRaw(text: string): void {
    this.socket.send(text);
  }

  close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.socket.once("close", () => {
        resolve();
      });
      this.socket.close();
    });
  }

  /** Resolves with the first queued (or next arriving) message matching `predicate`. */
  next<T extends ServerMessage["t"]>(
    type: T,
    extra?: (m: Extract<ServerMessage, { t: T }>) => boolean,
  ) {
    const predicate = (m: ServerMessage): boolean =>
      m.t === type && (extra === undefined || extra(m as Extract<ServerMessage, { t: T }>));
    return new Promise<Extract<ServerMessage, { t: T }>>((resolve, reject) => {
      const index = this.received.findIndex(predicate);
      if (index !== -1) {
        const [found] = this.received.splice(index, 1);
        resolve(found as Extract<ServerMessage, { t: T }>);
        return;
      }
      const timer = setTimeout(() => {
        reject(new Error(`timed out waiting for ${type}`));
      }, 2000);
      this.waiters.push({
        predicate,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { t: T }>);
        },
      });
    });
  }

  /**
   * Asserts nothing of `type` was sent to this client before now. Sends a probe the server
   * must answer (a second `start_match` is always an error) and, because a socket delivers
   * in order, anything sent earlier has arrived once the probe's answer has.
   */
  async expectNone(type: ServerMessage["t"]): Promise<void> {
    this.send({ t: "start_match" });
    await this.next("error", (m) => m.code !== "RATE_LIMITED");
    expect(this.received.filter((m) => m.t === type)).toEqual([]);
  }

  private deliver(message: ServerMessage): void {
    if (message.t === "update") this.version = message.version;
    const index = this.waiters.findIndex((w) => w.predicate(message));
    if (index !== -1) {
      const [waiter] = this.waiters.splice(index, 1);
      waiter?.resolve(message);
      return;
    }
    this.received.push(message);
  }
}

let handle: SocketServerHandle;
let registry: MatchRegistry;
const clients: TestClient[] = [];
/** Callbacks scheduled by the registry, fired by tests instead of by the clock. */
const scheduled: (() => void)[] = [];
const manualScheduler = {
  schedule(callback: () => void) {
    scheduled.push(callback);
    return {
      cancel: () => {
        const i = scheduled.indexOf(callback);
        if (i !== -1) scheduled.splice(i, 1);
      },
    };
  },
};
/** Resolves after the server has processed the next socket close. */
let disconnectWaiters: (() => void)[] = [];
function nextDisconnect(): Promise<void> {
  return new Promise((resolve) => disconnectWaiters.push(resolve));
}

/** Restarts the server with different socket limits for one test. */
async function restartWith(
  options: Partial<Parameters<typeof startSocketServer>[0]>,
): Promise<void> {
  await handle.close();
  handle = await startSocketServer({
    port: 0,
    onMessage: (session, message) => {
      handleClientMessage(registry, session, message);
    },
    onDisconnect: (session) => {
      handleDisconnect(registry, session);
      for (const resolve of disconnectWaiters.splice(0)) resolve();
    },
    ...options,
  });
}

beforeEach(async () => {
  registry = new MatchRegistry({
    deps: {
      createSeed: () => 1234,
      createRejoinToken: () => `token-${String(Math.random())}`,
      createLayout: () => SMALL_TEST_MAP,
    },
    abandonedMatchTtlMs: 50,
    scheduler: manualScheduler,
  });
  scheduled.length = 0;
  disconnectWaiters = [];
  handle = await startSocketServer({
    port: 0,
    onMessage: (session, message) => {
      handleClientMessage(registry, session, message);
    },
    onDisconnect: (session) => {
      handleDisconnect(registry, session);
      for (const resolve of disconnectWaiters.splice(0)) resolve();
    },
  });
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await handle.close();
});

async function connect(): Promise<TestClient> {
  const client = await TestClient.connect(handle.port);
  clients.push(client);
  return client;
}

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
    host.command({ type: "end_turn" }, { seq: 1 });
    await Promise.all([host.next("update"), guest.next("update")]);
    guest.command({ type: "end_turn" }, { seq: 1 });
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

    guest.command({ type: "end_turn" }, { seq: 1 });
    expect(await guest.next("rejected")).toEqual({
      t: "rejected",
      seq: 1,
      reason: "NOT_YOUR_TURN",
    });
    await host.expectNone("rejected");
    await host.expectNone("update");

    host.command({ type: "move", to: { x: 2, y: 1 } }, { seq: 2 });
    const [a, b] = await Promise.all([host.next("update"), guest.next("update")]);
    expect(a.version).toBe(1);
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

    host.command({ type: "end_turn" }, { seq: 1 });
    await Promise.all([host.next("update"), guest.next("update")]);
    guest.command({ type: "end_turn" }, { seq: 1 });
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
    host.command({ type: "fire_weapon", targetId: zombieId("z1") }, { seq: 1 });
    expect(await host.next("rejected")).toMatchObject({ seq: 1, reason: "OUT_OF_RANGE" });

    // Reloading a full magazine is rejected too; the state is unchanged for everyone.
    host.command({ type: "reload" }, { seq: 2 });
    expect(await host.next("rejected")).toMatchObject({ seq: 2, reason: "MAGAZINE_FULL" });
    await guest.expectNone("update");
  });

  it("starts with ground loot rolled from the seed", async () => {
    const { host, guest } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    const [first, second] = await Promise.all([host.next("update"), guest.next("update")]);
    expect(first.state.items).toHaveLength(2);
    expect(first.state.items).toEqual(second.state.items);
    host.command({ type: "pick_up", itemId: first.state.items[0]!.id }, { seq: 1 });
    expect(await host.next("rejected")).toMatchObject({ seq: 1, reason: "ITEM_NOT_HERE" });
  });

  it("validates searches on the server and never takes loot from the client", async () => {
    const { host, guest } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    const [first] = await Promise.all([host.next("update"), guest.next("update")]);
    expect(first.state.containers).toHaveLength(1);
    const container = first.state.containers[0]!;
    // The host spawns far from the fixture's container.
    host.command({ type: "search", containerId: container.id });
    expect((await host.next("rejected")).reason).toBe("CONTAINER_OUT_OF_REACH");
    await guest.expectNone("update");
  });

  it("ignores any playerId a client tries to smuggle in", async () => {
    const { host, guest, hostId } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    await Promise.all([host.next("update"), guest.next("update")]);
    guest.sendRaw(
      encodeMessage({
        t: "command",
        seq: 9,
        expectedVersion: 0,
        command: { type: "end_turn", playerId: hostId },
      }),
    );
    expect((await guest.next("rejected")).reason).toBe("NOT_YOUR_TURN");
  });
});

describe("http side", () => {
  it("answers the health check and serves the client from a static directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zombie-static-"));
    writeFileSync(join(dir, "index.html"), "<h1>ok</h1>");
    writeFileSync(join(dir, "app.js"), "console.log(1)");
    await restartWith({ staticDir: dir });
    const base = `http://127.0.0.1:${handle.port}`;
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

  it("serves only the health check when no static directory is configured", async () => {
    const base = `http://127.0.0.1:${handle.port}`;
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

describe("command sequencing", () => {
  it("refuses a repeated seq and a command composed against an old version", async () => {
    const { host, guest, hostId } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    await Promise.all([host.next("update"), guest.next("update")]);

    host.command({ type: "move", to: { x: 2, y: 1 } }, { seq: 5 });
    const moved = await host.next("update");
    await guest.next("update");
    expect(moved.version).toBe(1);

    // Same seq again: duplicate, nothing applied, nobody else hears about it.
    host.command({ type: "move", to: { x: 3, y: 1 } }, { seq: 5 });
    expect(await host.next("error")).toMatchObject({ code: "DUPLICATE_COMMAND", seq: 5 });

    // Fresh seq but stale version: refused, still nothing applied.
    host.command({ type: "move", to: { x: 3, y: 1 } }, { seq: 6, expectedVersion: 0 });
    expect(await host.next("error")).toMatchObject({ code: "STALE_STATE", seq: 6 });

    // A correct command now succeeds and is the very next update everyone sees.
    host.command({ type: "end_turn" }, { seq: 7 });
    const [a, b] = await Promise.all([host.next("update"), guest.next("update")]);
    expect(a.version).toBe(2);
    expect(b.state.players.find((p) => p.id === hostId)?.position).toEqual({ x: 2, y: 1 });
  });

  it("starts a fresh sequence on each socket so a reload is not treated as duplicates", async () => {
    const { host, guest, code, hostToken } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    await Promise.all([host.next("update"), guest.next("update")]);
    host.command({ type: "end_turn" }, { seq: 3 });
    await Promise.all([host.next("update"), guest.next("update")]);
    await host.close();
    await guest.next("update"); // presence change

    const again = await connect();
    again.send({ t: "rejoin_match", matchCode: code, rejoinToken: hostToken });
    await again.next("joined");
    const snapshot = await again.next("update");
    again.version = snapshot.version;
    // Not our turn (the guest holds it), so expect a gameplay rejection rather than a sequencing error.
    again.command({ type: "end_turn" }, { seq: 1 });
    expect((await again.next("rejected")).reason).toBe("NOT_YOUR_TURN");
  });
});

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
    secondTab.version = (await secondTab.next("update")).version;
    secondTab.command({ type: "reload" });
    expect((await secondTab.next("rejected")).reason).toBe("MAGAZINE_FULL");
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
    expect(registry.size()).toBe(1);
    const gone = nextDisconnect();
    await lonely.close();
    await gone;
    expect(registry.size()).toBe(0);

    const player = await connect();
    player.send({ t: "create_match", playerName: "Solo" });
    await player.next("joined");
    player.send({ t: "start_match" });
    await player.next("update");
    const left = nextDisconnect();
    await player.close();
    await left;
    expect(registry.size()).toBe(1);
    expect(scheduled).toHaveLength(1);
    scheduled.splice(0).forEach((fire) => {
      fire();
    });
    expect(registry.size()).toBe(0);
  });
});
