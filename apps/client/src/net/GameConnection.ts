import {
  decodeServerMessage,
  encodeMessage,
  type ClientMessage,
  type ServerMessage,
} from "@zombie/protocol";

export type ConnectionStatus = "connecting" | "open" | "closed";

/**
 * Thin wrapper over the browser WebSocket. Knows nothing about game state or Phaser;
 * it only encodes outgoing messages and decodes incoming ones.
 */
export class GameConnection {
  private socket: WebSocket | undefined;
  private readonly messageListeners = new Set<(message: ServerMessage) => void>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();

  constructor(private readonly url: string) {}

  connect(): void {
    this.socket?.close();
    const socket = new WebSocket(this.url);
    this.socket = socket;
    this.emitStatus("connecting");
    socket.addEventListener("open", () => {
      this.emitStatus("open");
    });
    socket.addEventListener("close", () => {
      this.emitStatus("closed");
    });
    socket.addEventListener("message", (event) => {
      const decoded = decodeServerMessage(String(event.data));
      if (!decoded.ok) {
        console.warn("ignoring server message:", decoded.error);
        return;
      }
      for (const listener of this.messageListeners) listener(decoded.value);
    });
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeMessage(message));
  }

  onMessage(listener: (message: ServerMessage) => void): void {
    this.messageListeners.add(listener);
  }

  onStatus(listener: (status: ConnectionStatus) => void): void {
    this.statusListeners.add(listener);
  }

  private emitStatus(status: ConnectionStatus): void {
    for (const listener of this.statusListeners) listener(status);
  }
}
