import { SMALL_TEST_MAP } from "@zombie/game-core";
import { afterEach, beforeEach } from "vitest";
import { MatchRegistry, type RegistryOptions } from "../lobby/MatchRegistry.js";
import { startSocketServer, type SocketServerHandle } from "../net/socketServer.js";
import { handleClientMessage, handleDisconnect } from "../router.js";
import { ProtocolClient } from "./protocolClient.js";

export interface Lobby {
  readonly clients: ProtocolClient[];
  readonly code: string;
  readonly playerIds: string[];
  readonly tokens: string[];
}

/**
 * A real server on an ephemeral port for one test at a time: fresh registry and listener
 * before each test, every client and the listener closed after it. The registry uses the
 * fixture map and a fixed seed unless `deps` overrides them, and a manual scheduler so
 * tests fire the abandonment timer themselves.
 */
export interface ServerHarness {
  readonly registry: MatchRegistry;
  readonly handle: SocketServerHandle;
  /** Callbacks the registry scheduled; fire them instead of waiting on the clock. */
  readonly scheduled: (() => void)[];
  readonly connect: () => Promise<ProtocolClient>;
  /** Resolves once the server has processed `count` more socket closes (default one). Register it before closing. */
  readonly nextDisconnect: (count?: number) => Promise<void>;
  /** Restarts the listener with different options for one test. */
  readonly restartWith: (
    options: Partial<Parameters<typeof startSocketServer>[0]>,
  ) => Promise<void>;
  /** A lobby of `n` players with client 0 as host; everyone has seen the full lobby list. */
  readonly lobbyOf: (n: number) => Promise<Lobby>;
  /** A started match of `n` players; every client has consumed its `map` and first `update`. */
  readonly matchOf: (n: number) => Promise<Lobby>;
}

export function createServerHarness(
  registryOptions: Omit<RegistryOptions, "scheduler"> = {},
): ServerHarness {
  let registry: MatchRegistry | undefined;
  let handle: SocketServerHandle | undefined;
  const clients: ProtocolClient[] = [];
  const scheduled: (() => void)[] = [];
  let disconnects = 0;
  let disconnectWaiters: { target: number; resolve: () => void }[] = [];
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

  const start = (options: Partial<Parameters<typeof startSocketServer>[0]>) =>
    startSocketServer({
      port: 0,
      onMessage: (session, message) => {
        handleClientMessage(current(), session, message);
      },
      onDisconnect: (session) => {
        handleDisconnect(current(), session);
        disconnects += 1;
        const due = disconnectWaiters.filter((w) => w.target <= disconnects);
        disconnectWaiters = disconnectWaiters.filter((w) => w.target > disconnects);
        for (const waiter of due) waiter.resolve();
      },
      ...options,
    });
  const current = (): MatchRegistry => {
    if (registry === undefined) throw new Error("harness used outside a test");
    return registry;
  };
  const listener = (): SocketServerHandle => {
    if (handle === undefined) throw new Error("harness used outside a test");
    return handle;
  };

  beforeEach(async () => {
    registry = new MatchRegistry({
      deps: {
        createSeed: () => 1234,
        createRejoinToken: () => `token-${String(Math.random())}`,
        createLayout: () => ({
          layout: SMALL_TEST_MAP,
          source: { kind: "fixture", name: "SMALL_TEST_MAP" },
        }),
      },
      abandonedMatchTtlMs: 50,
      ...registryOptions,
      scheduler: manualScheduler,
    });
    scheduled.length = 0;
    disconnects = 0;
    disconnectWaiters = [];
    handle = await start({});
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()));
    await listener().close();
    handle = undefined;
    registry = undefined;
  });

  const connect = async (): Promise<ProtocolClient> => {
    const client = await ProtocolClient.connect(listener().port);
    clients.push(client);
    return client;
  };

  const lobbyOf = async (n: number): Promise<Lobby> => {
    const host = await connect();
    host.send({ t: "create_match", playerName: "P1" });
    const joined = await host.next("joined");
    const lobby: Lobby = {
      clients: [host],
      code: joined.matchCode,
      playerIds: [joined.playerId],
      tokens: [joined.rejoinToken],
    };
    for (let i = 2; i <= n; i += 1) {
      const guest = await connect();
      guest.send({ t: "join_match", matchCode: lobby.code, playerName: `P${i}` });
      const guestJoined = await guest.next("joined");
      lobby.clients.push(guest);
      lobby.playerIds.push(guestJoined.playerId);
      lobby.tokens.push(guestJoined.rejoinToken);
    }
    await Promise.all(lobby.clients.map((c) => c.next("lobby", (m) => m.players.length === n)));
    return lobby;
  };

  return {
    get registry() {
      return current();
    },
    get handle() {
      return listener();
    },
    scheduled,
    connect,
    nextDisconnect: (count = 1) =>
      new Promise((resolve) => disconnectWaiters.push({ target: disconnects + count, resolve })),
    restartWith: async (options) => {
      await listener().close();
      handle = await start(options);
    },
    lobbyOf,
    matchOf: async (n) => {
      const lobby = await lobbyOf(n);
      lobby.clients[0]?.send({ t: "start_match" });
      await Promise.all(lobby.clients.map((c) => c.next("map")));
      await Promise.all(lobby.clients.map((c) => c.next("update")));
      return lobby;
    },
  };
}
