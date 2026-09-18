import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION, type ServerMessage } from "@zombie/protocol";
import { GameConnection, type ConnectionStatus } from "./GameConnection.js";

/** Minimal stand-in for the browser WebSocket: tests open, close, and deliver by hand. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, ((event: { data?: string }) => void)[]>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open", {});
  }
  drop(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }
  deliver(message: ServerMessage): void {
    this.emit("message", { data: JSON.stringify(message) });
  }
  private emit(type: string, event: { data?: string }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("GameConnection", () => {
  it("reports status, sends only while open, and decodes incoming messages", () => {
    const connection = new GameConnection("ws://test", "test");
    const statuses: ConnectionStatus[] = [];
    const messages: ServerMessage[] = [];
    connection.onStatus((s) => statuses.push(s));
    connection.onMessage((m) => messages.push(m));
    connection.connect();
    const socket = FakeWebSocket.instances[0]!;
    connection.send({ t: "start_match" });
    expect(socket.sent).toEqual([]); // not open yet
    socket.open();
    connection.send({ t: "start_match" });
    // The handshake goes out on open, before anything the app sends.
    expect(socket.sent).toEqual([
      JSON.stringify({ t: "hello", protocolVersion: PROTOCOL_VERSION, gameVersion: "test" }),
      '{"t":"start_match"}',
    ]);
    socket.deliver({ t: "error", code: "NOT_HOST", message: "no" });
    expect(messages).toEqual([{ t: "error", code: "NOT_HOST", message: "no" }]);
    expect(statuses).toEqual(["connecting", "open"]);
  });

  it("reconnects after a drop with growing delays and resets the delay once open", () => {
    const connection = new GameConnection("ws://test", "test");
    connection.connect();
    FakeWebSocket.instances[0]!.open();
    FakeWebSocket.instances[0]!.drop();
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1]!.drop(); // never opened: delay doubles
    vi.advanceTimersByTime(1999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
    FakeWebSocket.instances[2]!.open();
    FakeWebSocket.instances[2]!.drop();
    vi.advanceTimersByTime(1000); // back to the minimum after a successful open
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it("ignores a close from a socket it has already replaced", () => {
    const connection = new GameConnection("ws://test", "test");
    connection.connect();
    const first = FakeWebSocket.instances[0]!;
    connection.connect();
    first.drop();
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});
