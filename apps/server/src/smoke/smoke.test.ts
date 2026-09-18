import { describe, expect, it } from "vitest";
import { createServerHarness } from "../testing/harness.js";
import { runSmoke } from "./runSmoke.js";

const harness = createServerHarness();

describe("deployment smoke test", () => {
  it("passes every step against a healthy server", async () => {
    const result = await runSmoke({ url: `ws://127.0.0.1:${harness.handle.port}` });
    expect(result.steps.map((s) => `${s.name}:${s.ok ? "ok" : "fail"}`)).toEqual([
      "handshake:ok",
      "create lobby:ok",
      "join lobby:ok",
      "start match:ok",
      "accepted command:ok",
      "reconnect with token:ok",
    ]);
    expect(result.ok).toBe(true);
    expect(result.server?.simulationVersion).toBeTypeOf("number");
  });

  it("reports the failing step instead of throwing when nothing answers", async () => {
    const result = await runSmoke({ url: "ws://127.0.0.1:1", timeoutMs: 500 });
    expect(result.ok).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ name: "handshake", ok: false });
  });
});
