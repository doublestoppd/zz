import { WebSocket } from "ws";
import { zombieId } from "@zombie/game-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decodeServerMessage,
  encodeMessage,
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

  private constructor(private readonly socket: WebSocket) {}

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

  send(message: ClientMessage): void {
    this.socket.send(encodeMessage(message));
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

  /** Asserts nothing of `type` arrives within a short window. */
  async expectNone(type: ServerMessage["t"], withinMs = 150): Promise<void> {
    await new Promise((r) => setTimeout(r, withinMs));
    expect(this.received.filter((m) => m.t === type)).toEqual([]);
  }

  private deliver(message: ServerMessage): void {
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

beforeEach(async () => {
  registry = new MatchRegistry({
    deps: { createSeed: () => 1234, createRejoinToken: () => `token-${String(Math.random())}` },
    abandonedMatchTtlMs: 50,
  });
  handle = await startSocketServer({
    port: 0,
    onMessage: (session, message) => {
      handleClientMessage(registry, session, message);
    },
    onDisconnect: (session) => {
      handleDisconnect(registry, session);
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

describe("gameplay", () => {
  it("broadcasts accepted moves to everyone and rejections to the sender only", async () => {
    const { host, guest, hostId } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    await Promise.all([host.next("update"), guest.next("update")]);

    guest.send({ t: "command", seq: 1, command: { type: "end_turn" } });
    expect(await guest.next("rejected")).toEqual({
      t: "rejected",
      seq: 1,
      reason: "NOT_YOUR_TURN",
    });
    await host.expectNone("rejected");
    await host.expectNone("update");

    host.send({ t: "command", seq: 2, command: { type: "move", to: { x: 2, y: 1 } } });
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
    expect(first.state.zombies.length).toBeGreaterThan(0);

    host.send({ t: "command", seq: 1, command: { type: "end_turn" } });
    await Promise.all([host.next("update"), guest.next("update")]);
    guest.send({ t: "command", seq: 1, command: { type: "end_turn" } });
    const [after] = await Promise.all([host.next("update"), guest.next("update")]);
    expect(after.state.round).toBe(2);
    expect(after.events.some((e) => e.type === "zombie_moved")).toBe(true);
    expect(after.state.zombies).not.toEqual(first.state.zombies);
  });

  it("applies fire and reload commands from the active player", async () => {
    const { host, guest } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    await Promise.all([host.next("update"), guest.next("update")]);

    // No zombie is in range at the spawn, so the shot is rejected with a combat reason.
    host.send({ t: "command", seq: 1, command: { type: "fire_weapon", targetId: zombieId("z1") } });
    expect(await host.next("rejected")).toMatchObject({ seq: 1, reason: "OUT_OF_RANGE" });

    // Reloading a full magazine is rejected too; the state is unchanged for everyone.
    host.send({ t: "command", seq: 2, command: { type: "reload" } });
    expect(await host.next("rejected")).toMatchObject({ seq: 2, reason: "MAGAZINE_FULL" });
    await guest.expectNone("update");
  });

  it("ignores any playerId a client tries to smuggle in", async () => {
    const { host, guest, hostId } = await twoPlayerLobby();
    host.send({ t: "start_match" });
    await Promise.all([host.next("update"), guest.next("update")]);
    guest.sendRaw(
      encodeMessage({ t: "command", seq: 9, command: { type: "end_turn", playerId: hostId } }),
    );
    expect((await guest.next("rejected")).reason).toBe("NOT_YOUR_TURN");
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
    await lonely.close();
    await new Promise((r) => setTimeout(r, 20));
    expect(registry.size()).toBe(0);

    const player = await connect();
    player.send({ t: "create_match", playerName: "Solo" });
    await player.next("joined");
    player.send({ t: "start_match" });
    await player.next("update");
    await player.close();
    await new Promise((r) => setTimeout(r, 20));
    expect(registry.size()).toBe(1);
    await new Promise((r) => setTimeout(r, 80));
    expect(registry.size()).toBe(0);
  });
});
