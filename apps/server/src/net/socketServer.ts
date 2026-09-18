import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { SIMULATION_VERSION } from "@zombie/game-core";
import {
  decodeClientMessage,
  encodeMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
} from "@zombie/protocol";
import { GAME_VERSION } from "../version.js";
import { sendError } from "../errors.js";
import { log as logLine } from "../log.js";
import { metrics } from "../observability/metrics.js";
import type { HttpOptions } from "./httpServer.js";
import type { ClientSession } from "../session/ClientSession.js";
import { createHttpServer } from "./httpServer.js";

function rawDataToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

export interface SocketServerOptions {
  readonly port: number;
  readonly host?: string;
  readonly onMessage: (session: ClientSession, message: ClientMessage) => void;
  readonly onDisconnect: (session: ClientSession) => void;
  readonly log?: (line: string) => void;
  /** Frames above this size close the socket (1009). The largest legitimate message is well under 1 KB. */
  readonly maxPayloadBytes?: number;
  /** New connections beyond this count are refused (1013). */
  readonly maxConnections?: number;
  /** Sockets one client address may hold at once; the rest are refused before the upgrade (default 16). */
  readonly maxConnectionsPerAddress?: number;
  /**
   * Browser origins allowed to open a socket. Unset: any origin (development). A browser
   * always sends `Origin`; a non-browser client may omit it and is not subject to the list.
   */
  readonly allowedOrigins?: readonly string[];
  /** Behind a reverse proxy: take the client address from the first `X-Forwarded-For` entry. */
  readonly trustProxy?: boolean;
  /** A socket that has not answered the previous ping by the next one is terminated. */
  readonly pingIntervalMs?: number;
  /** Token bucket per socket: `burst` messages at once, refilled at `perSecond`. */
  readonly rateLimit?: { readonly burst: number; readonly perSecond: number };
  /** Serve the built client from this directory on the same port (see net/httpServer.ts). */
  readonly staticDir?: string;
  /** HTTP-side diagnostics (see net/httpServer.ts); tests pass a registry's diagnostics. */
  readonly http?: Omit<HttpOptions, "staticDir">;
}

export interface SocketServerHandle {
  readonly port: number;
  close(): Promise<void>;
}

const DEFAULTS = {
  maxPayloadBytes: 16 * 1024,
  maxConnections: 200,
  maxConnectionsPerAddress: 16,
  pingIntervalMs: 30_000,
  rateLimit: { burst: 20, perSecond: 10 },
} as const;

/** Close codes from RFC 6455 used here. */
const CLOSE_POLICY_VIOLATION = 1008;
const CLOSE_GOING_AWAY = 1001;

/**
 * The only file that knows about the `ws` library. It turns sockets into ClientSessions,
 * decodes incoming text through the protocol package, answers malformed input itself, and
 * applies the abuse limits (payload size, connection count, liveness, message rate) so
 * nothing above it has to.
 */
export function startSocketServer(options: SocketServerOptions): Promise<SocketServerHandle> {
  const log = options.log ?? ((): void => undefined);
  const maxConnections = options.maxConnections ?? DEFAULTS.maxConnections;
  const rateLimit = options.rateLimit ?? DEFAULTS.rateLimit;
  // One listener serves /healthz (and optionally the client) over HTTP and upgrades to WebSocket.
  const httpOptions: HttpOptions = {
    ...(options.http ?? {}),
    ...(options.staticDir === undefined ? {} : { staticDir: options.staticDir }),
  };
  const http = createHttpServer(httpOptions);
  const server = new WebSocketServer({
    noServer: true,
    maxPayload: options.maxPayloadBytes ?? DEFAULTS.maxPayloadBytes,
  });
  const maxPerAddress = options.maxConnectionsPerAddress ?? DEFAULTS.maxConnectionsPerAddress;
  const perAddress = new Map<string, number>();
  const allowedOrigins =
    options.allowedOrigins === undefined ? undefined : new Set(options.allowedOrigins);

  const refuse = (socket: Duplex, status: number, reason: string): void => {
    metrics.increment("zombie_connections_refused_total", { reason });
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  // Upgrades are checked before a WebSocket exists, so a refused client costs one HTTP
  // response and never reaches the message handlers.
  http.on("upgrade", (request, socket, head) => {
    const origin = request.headers.origin;
    if (allowedOrigins !== undefined && origin !== undefined && !allowedOrigins.has(origin)) {
      refuse(socket, 403, "origin not allowed");
      return;
    }
    if (server.clients.size >= maxConnections) {
      refuse(socket, 503, "server full");
      return;
    }
    const address = clientAddress(request, options.trustProxy === true);
    if ((perAddress.get(address) ?? 0) >= maxPerAddress) {
      refuse(socket, 429, "too many connections from this address");
      return;
    }
    server.handleUpgrade(request, socket, head, (ws) => {
      server.emit("connection", ws, request);
    });
  });

  const alive = new WeakMap<WebSocket, boolean>();
  const pinger = setInterval(() => {
    for (const socket of server.clients) {
      if (alive.get(socket) === false) {
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      socket.ping();
    }
  }, options.pingIntervalMs ?? DEFAULTS.pingIntervalMs);
  pinger.unref();

  server.on("connection", (socket, request: IncomingMessage) => {
    const address = clientAddress(request, options.trustProxy === true);
    perAddress.set(address, (perAddress.get(address) ?? 0) + 1);
    metrics.increment("zombie_connections_total");
    metrics.set("zombie_connected_sockets", server.clients.size);
    alive.set(socket, true);
    socket.on("pong", () => alive.set(socket, true));

    const session: ClientSession = {
      id: randomUUID(),
      address,
      matchCode: undefined,
      playerId: undefined,
      send(message) {
        if (socket.readyState === WebSocket.OPEN) socket.send(encodeMessage(message));
      },
      close(reason = "replaced") {
        if (reason === "going_away") socket.close(CLOSE_GOING_AWAY, "server restarting");
        else if (reason === "version_mismatch")
          socket.close(CLOSE_POLICY_VIOLATION, "version mismatch");
        else socket.close(CLOSE_POLICY_VIOLATION, "session replaced");
      },
    };

    // The handshake: nothing but `hello` is accepted until the versions have been checked.
    let greeted = false;
    const refuseVersion = (announced: number | null, gameVersion: string | null): void => {
      metrics.increment("zombie_handshakes_total", { outcome: "mismatch" });
      logLine("info", "version mismatch", {
        category: "session",
        sessionId: session.id,
        address,
        clientProtocolVersion: announced,
        clientGameVersion: gameVersion,
        serverProtocolVersion: PROTOCOL_VERSION,
      });
      sendError(session, "VERSION_MISMATCH");
      session.close("version_mismatch");
    };

    const bucket = { tokens: rateLimit.burst, last: Date.now(), dropped: 0 };
    const allow = (): boolean => {
      const now = Date.now();
      bucket.tokens = Math.min(
        rateLimit.burst,
        bucket.tokens + ((now - bucket.last) / 1000) * rateLimit.perSecond,
      );
      bucket.last = now;
      if (bucket.tokens < 1) return false;
      bucket.tokens -= 1;
      bucket.dropped = 0;
      return true;
    };

    socket.on("message", (data, isBinary) => {
      if (!allow()) {
        bucket.dropped += 1;
        metrics.increment("zombie_messages_rate_limited_total");
        sendError(session, "RATE_LIMITED");
        // A client that keeps flooding after being told is disconnected.
        if (bucket.dropped > rateLimit.burst) socket.close(CLOSE_POLICY_VIOLATION, "rate limit");
        return;
      }
      const text = isBinary ? "" : rawDataToString(data);
      const decoded = decodeClientMessage(text);
      if (!decoded.ok) {
        metrics.increment("zombie_messages_malformed_total");
        // A bad command body inside a good envelope is answered per command, so the
        // client can clear that command; anything else is a session-level error.
        if (decoded.commandId !== undefined) {
          session.send({
            t: "rejected",
            commandId: decoded.commandId,
            reason: "MALFORMED_COMMAND",
          });
        } else {
          sendError(session, "MALFORMED_MESSAGE");
        }
        return;
      }
      if (decoded.value.t === "hello") {
        if (decoded.value.protocolVersion !== PROTOCOL_VERSION) {
          refuseVersion(decoded.value.protocolVersion, decoded.value.gameVersion);
          return;
        }
        greeted = true;
        metrics.increment("zombie_handshakes_total", { outcome: "accepted" });
        session.send({
          t: "welcome",
          protocolVersion: PROTOCOL_VERSION,
          gameVersion: GAME_VERSION,
          simulationVersion: SIMULATION_VERSION,
        });
        return;
      }
      if (!greeted) {
        // A client that speaks before saying hello predates the handshake: same answer.
        refuseVersion(null, null);
        return;
      }
      try {
        options.onMessage(session, decoded.value);
      } catch (error) {
        // A bug in one handler must not take the whole server down. The correlation fields
        // are enough to find the match journal and the command in the logs.
        metrics.increment("zombie_handler_exceptions_total");
        logLine("error", "handler exception", {
          category: "server",
          sessionId: session.id,
          matchCode: session.matchCode ?? null,
          playerId: session.playerId ?? null,
          messageType: decoded.value.t,
          commandId: decoded.value.t === "command" ? decoded.value.commandId : null,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          stack: error instanceof Error ? (error.stack ?? null) : null,
        });
        sendError(session, "INTERNAL_ERROR");
      }
    });

    socket.on("close", () => {
      const remaining = (perAddress.get(address) ?? 1) - 1;
      if (remaining <= 0) perAddress.delete(address);
      else perAddress.set(address, remaining);
      metrics.set("zombie_connected_sockets", Math.max(0, server.clients.size - 1));
      options.onDisconnect(session);
    });

    socket.on("error", (error) => {
      log(`socket error for session ${session.id}: ${error.message}`);
    });
  });

  return new Promise((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port, options.host ?? "0.0.0.0", () => {
      const address = http.address();
      const port = typeof address === "object" && address !== null ? address.port : options.port;
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(pinger);
            for (const client of server.clients) client.terminate();
            server.close(() => {
              http.close(() => {
                done();
              });
            });
          }),
      });
    });
  });
}

/**
 * The address limits and logs are keyed by. Only a deployment that terminates TLS at a
 * proxy sets `trustProxy`; otherwise a client could claim any address in the header.
 */
function clientAddress(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
    if (first !== undefined && first !== "") return first;
  }
  return request.socket.remoteAddress ?? "unknown";
}
