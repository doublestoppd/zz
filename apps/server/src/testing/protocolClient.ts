import { WebSocket } from "ws";
import {
  decodeServerMessage,
  encodeMessage,
  PROTOCOL_VERSION,
  type ClientCommand,
  type ClientMessage,
  type ServerMessage,
} from "@zombie/protocol";

/**
 * A client that speaks the real wire protocol over a real socket and queues every server
 * message so callers can await specific ones. Used by the integration tests and the soak
 * bots; it has no knowledge of the game beyond the message types.
 */
export class ProtocolClient {
  private readonly received: ServerMessage[] = [];
  private readonly waiters: {
    predicate: (m: ServerMessage) => boolean;
    resolve: (m: ServerMessage) => void;
    reject: (error: Error) => void;
  }[] = [];
  private closeCode: number | undefined;

  private constructor(
    private readonly socket: WebSocket,
    private readonly timeoutMs: number,
  ) {
    this.closed = new Promise((resolve) => {
      socket.once("close", (code) => {
        this.closeCode = code;
        // Nobody will ever be answered on a closed socket: fail every pending wait now.
        for (const waiter of this.waiters.splice(0))
          waiter.reject(new Error(`socket closed (${code})`));
        resolve(code);
      });
    });
    socket.on("ping", () => {
      this.pings += 1;
    });
  }

  /**
   * Opens a socket to a port on the loopback or to a full `ws://` / `wss://` URL and,
   * unless `handshake` is false, sends `hello` with this build's versions (or
   * `protocolVersion` when given) and waits for the `welcome`.
   */
  static connect(
    target: number | string,
    options: {
      timeoutMs?: number;
      headers?: Record<string, string>;
      handshake?: boolean;
      protocolVersion?: number;
    } = {},
  ): Promise<ProtocolClient> {
    return new Promise((resolve, reject) => {
      const url = typeof target === "number" ? `ws://127.0.0.1:${target}` : target;
      const socket = new WebSocket(url, { headers: options.headers ?? {} });
      const client = new ProtocolClient(socket, options.timeoutMs ?? 2000);
      socket.on("message", (data) => {
        const text = Array.isArray(data)
          ? Buffer.concat(data).toString()
          : Buffer.from(data as Buffer).toString();
        const decoded = decodeServerMessage(text);
        if (!decoded.ok) throw new Error(decoded.error);
        client.deliver(decoded.value);
      });
      socket.once("open", () => {
        if (options.handshake === false) {
          resolve(client);
          return;
        }
        client.send({
          t: "hello",
          protocolVersion: options.protocolVersion ?? PROTOCOL_VERSION,
          gameVersion: "test",
        });
        client
          .next("welcome")
          .then(() => {
            resolve(client);
          })
          .catch(reject);
      });
      socket.once("error", reject);
    });
  }

  /** Revision of the latest `update` seen, whether or not a caller has consumed it yet. */
  revision = 0;
  /** What the last `joined` said this client is; kept whether or not a caller consumed the message. */
  identity: { matchCode: string; playerId: string; rejoinToken: string } | undefined;
  pings = 0;
  /** Resolves with the close code once the server closes the socket. */
  readonly closed: Promise<number>;
  private static nextCommandNumber = 0;

  send(message: ClientMessage): void {
    this.socket.send(encodeMessage(message));
  }

  /** Sends a gameplay command with a fresh id and the latest known revision. */
  command(
    command: ClientCommand,
    overrides: { commandId?: string; baseRevision?: number } = {},
  ): string {
    // Ids are unique per player across sockets, so the counter is shared by every client.
    ProtocolClient.nextCommandNumber += 1;
    const commandId = overrides.commandId ?? `cmd-${ProtocolClient.nextCommandNumber}`;
    this.send({
      t: "command",
      commandId,
      baseRevision: overrides.baseRevision ?? this.revision,
      command,
    });
    return commandId;
  }

  /** The address the server keys this client's limits by (the loopback peer in tests). */
  address(): string {
    return "127.0.0.1";
  }

  sendRaw(text: string): void {
    this.socket.send(text);
  }

  isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
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

  /** Drops the connection without a close handshake, as a crashed browser or lost network would. */
  terminate(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.socket.once("close", () => {
        resolve();
      });
      this.socket.terminate();
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
      if (this.closeCode !== undefined) {
        reject(new Error(`socket closed (${this.closeCode}) before ${type}`));
        return;
      }
      const timer = setTimeout(() => {
        reject(new Error(`timed out waiting for ${type}`));
      }, this.timeoutMs);
      this.waiters.push({
        predicate,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { t: T }>);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  /** Resolves with the next message of any type (queued first). */
  nextAny(): Promise<ServerMessage> {
    return new Promise<ServerMessage>((resolve, reject) => {
      const queued = this.received.shift();
      if (queued !== undefined) {
        resolve(queued);
        return;
      }
      if (this.closeCode !== undefined) {
        reject(new Error(`socket closed (${this.closeCode})`));
        return;
      }
      const timer = setTimeout(() => {
        reject(new Error("timed out waiting for any message"));
      }, this.timeoutMs);
      this.waiters.push({
        predicate: () => true,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  /** Messages received and not yet consumed, oldest first (a copy). */
  pending(): ServerMessage[] {
    return [...this.received];
  }

  /**
   * Throws if anything of `type` was sent to this client before now. Sends a probe the
   * server must answer (a second `start_match` is always an error) and, because a socket
   * delivers in order, anything sent earlier has arrived once the probe's answer has.
   */
  async expectNone(type: ServerMessage["t"]): Promise<void> {
    this.send({ t: "start_match" });
    await this.next("error", (m) => m.code !== "RATE_LIMITED");
    const leaked = this.received.filter((m) => m.t === type);
    if (leaked.length > 0) throw new Error(`expected no ${type}, got ${JSON.stringify(leaked)}`);
  }

  private deliver(message: ServerMessage): void {
    if (message.t === "update") this.revision = message.revision;
    if (message.t === "joined") {
      this.identity = {
        matchCode: message.matchCode,
        playerId: message.playerId,
        rejoinToken: message.rejoinToken,
      };
    }
    const index = this.waiters.findIndex((w) => w.predicate(message));
    if (index !== -1) {
      const [waiter] = this.waiters.splice(index, 1);
      waiter?.resolve(message);
      return;
    }
    this.received.push(message);
  }
}
