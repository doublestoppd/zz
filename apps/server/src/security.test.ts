import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createServerHarness } from "./testing/harness.js";
import { ProtocolClient } from "./testing/protocolClient.js";

/**
 * The abuse limits at the network boundary (docs/SECURITY.md): origin allowlist, sockets
 * per address, room capacity, failed-lookup throttling, and the HTTP side's hardening.
 * Payload size, per-socket message rate, and malformed input are covered in server.test.ts.
 */
const harness = createServerHarness({
  maxMatches: 1,
  lookupFailures: { max: 3, windowMs: 60_000 },
});
const { connect, restartWith } = harness;

describe("upgrade limits", () => {
  it("refuses browser origins outside the allowlist before any socket exists", async () => {
    await restartWith({ allowedOrigins: ["https://game.example"] });
    const port = harness.handle.port;
    await expect(
      ProtocolClient.connect(port, { headers: { origin: "https://evil.example" } }),
    ).rejects.toThrow(/403/);
    const allowed = await ProtocolClient.connect(port, {
      headers: { origin: "https://game.example" },
    });
    allowed.send({ t: "create_match", playerName: "Ok" });
    expect((await allowed.next("joined")).matchCode).toHaveLength(4);
    await allowed.close();
    // A non-browser client sends no Origin and is not subject to the list.
    const bare = await ProtocolClient.connect(port);
    await bare.close();
  });

  it("caps the sockets one address may hold", async () => {
    await restartWith({ maxConnectionsPerAddress: 2 });
    const port = harness.handle.port;
    const first = await ProtocolClient.connect(port);
    const second = await ProtocolClient.connect(port);
    await expect(ProtocolClient.connect(port)).rejects.toThrow(/429/);
    await first.close();
    // Closing one frees a slot.
    const third = await ProtocolClient.connect(port);
    await third.close();
    await second.close();
  });

  it("takes the address from X-Forwarded-For only behind a trusted proxy", async () => {
    await restartWith({ maxConnectionsPerAddress: 1, trustProxy: true });
    const port = harness.handle.port;
    const a = await ProtocolClient.connect(port, { headers: { "x-forwarded-for": "10.0.0.1" } });
    const b = await ProtocolClient.connect(port, { headers: { "x-forwarded-for": "10.0.0.2" } });
    await expect(
      ProtocolClient.connect(port, { headers: { "x-forwarded-for": "10.0.0.2, 10.0.0.9" } }),
    ).rejects.toThrow(/429/);
    await a.close();
    await b.close();
  });
});

describe("room and lookup limits", () => {
  it("answers SERVER_FULL at the room limit and accepts again once a lobby is gone", async () => {
    const host = await connect();
    host.send({ t: "create_match", playerName: "Host" });
    await host.next("joined");
    const second = await connect();
    second.send({ t: "create_match", playerName: "Late" });
    expect((await second.next("error")).code).toBe("SERVER_FULL");
    const gone = harness.nextDisconnect();
    await host.close();
    await gone;
    second.send({ t: "create_match", playerName: "Late" });
    expect((await second.next("joined")).matchCode).toHaveLength(4);
  });

  it("throttles an address after repeated failed lookups so codes cannot be enumerated", async () => {
    const host = await connect();
    host.send({ t: "create_match", playerName: "Host" });
    const { matchCode, rejoinToken } = await host.next("joined");
    const guesser = await connect();
    for (const code of ["AAAA", "BBBB"]) {
      guesser.send({ t: "join_match", matchCode: code, playerName: "G" });
      expect((await guesser.next("error")).code).toBe("MATCH_NOT_FOUND");
    }
    guesser.send({ t: "rejoin_match", matchCode, rejoinToken: "wrong" });
    expect((await guesser.next("error")).code).toBe("INVALID_REJOIN_TOKEN");
    // Three failures used up the window: even a correct guess is refused now.
    guesser.send({ t: "join_match", matchCode, playerName: "G" });
    expect((await guesser.next("error")).code).toBe("RATE_LIMITED");
    guesser.send({ t: "rejoin_match", matchCode, rejoinToken });
    expect((await guesser.next("error")).code).toBe("RATE_LIMITED");
    expect(harness.registry.allowLookup("test-elsewhere")).toBe(true);
    // The window passes: the same address is welcome again.
    const later = Date.now() + 61_000;
    expect(harness.registry.allowLookup(guesser.address(), later)).toBe(true);
  });
});

describe("http hardening", () => {
  it("answers a malformed percent-escape with 400 and a traversal with 403, and sends security headers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zombie-static-"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>zz</title>");
    await restartWith({ staticDir: dir });
    const base = `http://127.0.0.1:${harness.handle.port}`;
    expect((await fetch(`${base}/%`)).status).toBe(400);
    // The URL parser already folds `..` away; the path guard behind it is defence in depth.
    for (const path of [
      "/%2e%2e/%2e%2e/etc/passwd",
      "/../../etc/passwd",
      "/..%2f..%2fetc/passwd",
    ]) {
      const answer = await fetch(`${base}${path}`);
      expect([403, 404], path).toContain(answer.status);
    }
    const index = await fetch(`${base}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get("x-content-type-options")).toBe("nosniff");
    expect(index.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
    expect(index.headers.get("referrer-policy")).toBe("no-referrer");
    const health = await fetch(`${base}/healthz`);
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
