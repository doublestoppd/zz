import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { decodeClientMessage, encodeMessage, type ClientMessage } from "@zombie/protocol";
import type { ClientSession } from "../session/ClientSession.js";
import { sendError } from "../router.js";

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
}

export interface SocketServerHandle {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * The only file that knows about the `ws` library. It turns sockets into ClientSessions,
 * decodes incoming text through the protocol package, and answers malformed input itself.
 */
export function startSocketServer(options: SocketServerOptions): Promise<SocketServerHandle> {
  const log = options.log ?? ((): void => undefined);
  const server = new WebSocketServer({ port: options.port, host: options.host ?? "0.0.0.0" });

  server.on("connection", (socket) => {
    const session: ClientSession = {
      id: randomUUID(),
      matchCode: undefined,
      playerId: undefined,
      send(message) {
        if (socket.readyState === WebSocket.OPEN) socket.send(encodeMessage(message));
      },
    };

    socket.on("message", (data, isBinary) => {
      const text = isBinary ? "" : rawDataToString(data);
      const decoded = decodeClientMessage(text);
      if (!decoded.ok) {
        sendError(session, "MALFORMED_MESSAGE");
        return;
      }
      try {
        options.onMessage(session, decoded.value);
      } catch (error) {
        // A bug in one handler must not take the whole server down.
        log(`handler error for session ${session.id}: ${String(error)}`);
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
    server.once("error", reject);
    server.once("listening", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : options.port;
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            for (const client of server.clients) client.terminate();
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}
