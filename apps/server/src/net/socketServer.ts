import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { decodeClientMessage, encodeMessage, type ClientMessage } from "@zombie/protocol";
import { sendError } from "../errors.js";
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
  /** A socket that has not answered the previous ping by the next one is terminated. */
  readonly pingIntervalMs?: number;
  /** Token bucket per socket: `burst` messages at once, refilled at `perSecond`. */
  readonly rateLimit?: { readonly burst: number; readonly perSecond: number };
  /** Serve the built client from this directory on the same port (see net/httpServer.ts). */
  readonly staticDir?: string;
}

export interface SocketServerHandle {
  readonly port: number;
  close(): Promise<void>;
}

const DEFAULTS = {
  maxPayloadBytes: 16 * 1024,
  maxConnections: 200,
  pingIntervalMs: 30_000,
  rateLimit: { burst: 20, perSecond: 10 },
} as const;

/** Close codes from RFC 6455 used here. */
const CLOSE_POLICY_VIOLATION = 1008;
const CLOSE_GOING_AWAY = 1001;
const CLOSE_TRY_AGAIN_LATER = 1013;

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
  const httpOptions = options.staticDir === undefined ? {} : { staticDir: options.staticDir };
  const http = createHttpServer(httpOptions);
  const server = new WebSocketServer({
    server: http,
    maxPayload: options.maxPayloadBytes ?? DEFAULTS.maxPayloadBytes,
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

  server.on("connection", (socket) => {
    if (server.clients.size > maxConnections) {
      socket.close(CLOSE_TRY_AGAIN_LATER, "server full");
      return;
    }
    alive.set(socket, true);
    socket.on("pong", () => alive.set(socket, true));

    const session: ClientSession = {
      id: randomUUID(),
      matchCode: undefined,
      playerId: undefined,
      send(message) {
        if (socket.readyState === WebSocket.OPEN) socket.send(encodeMessage(message));
      },
      close(reason = "replaced") {
        if (reason === "going_away") socket.close(CLOSE_GOING_AWAY, "server restarting");
        else socket.close(CLOSE_POLICY_VIOLATION, "session replaced");
      },
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
        sendError(session, "RATE_LIMITED");
        // A client that keeps flooding after being told is disconnected.
        if (bucket.dropped > rateLimit.burst) socket.close(CLOSE_POLICY_VIOLATION, "rate limit");
        return;
      }
      const text = isBinary ? "" : rawDataToString(data);
      const decoded = decodeClientMessage(text);
      if (!decoded.ok) {
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
      try {
        options.onMessage(session, decoded.value);
      } catch (error) {
        // A bug in one handler must not take the whole server down.
        log(`handler error for session ${session.id}: ${String(error)}`);
        sendError(session, "INTERNAL_ERROR");
      }
    });

    socket.on("close", () => {
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
