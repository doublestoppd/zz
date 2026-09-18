import { describe, expect, it } from "vitest";
import { Metrics } from "./metrics.js";

describe("Metrics", () => {
  it("counts, gauges, times, and renders in the Prometheus text format", () => {
    const m = new Metrics();
    m.increment("zombie_commands_total", { outcome: "accepted" });
    m.increment("zombie_commands_total", { outcome: "accepted" });
    m.increment("zombie_commands_total", { outcome: "rejected", reason: "STALE_REVISION" });
    m.set("zombie_active_matches", 3);
    m.observe("zombie_command_duration_ms", 4);
    m.observe("zombie_command_duration_ms", 40);
    const text = m.render();
    expect(text).toContain('zombie_commands_total{outcome="accepted"} 2');
    expect(text).toContain('zombie_commands_total{outcome="rejected",reason="STALE_REVISION"} 1');
    expect(text).toContain("zombie_active_matches 3");
    expect(text).toContain('zombie_command_duration_ms_bucket{le="1"} 0');
    expect(text).toContain('zombie_command_duration_ms_bucket{le="5"} 1');
    expect(text).toContain('zombie_command_duration_ms_bucket{le="50"} 2');
    expect(text).toContain('zombie_command_duration_ms_bucket{le="+Inf"} 2');
    expect(text).toContain("zombie_command_duration_ms_sum 44");
    expect(text).toContain("zombie_command_duration_ms_count 2");
    // `time` returns the work's result and records one more observation.
    expect(m.time("zombie_command_duration_ms", {}, () => 7)).toBe(7);
    expect(m.render()).toContain("zombie_command_duration_ms_count 3");
    expect(m.counterValue("zombie_commands_total", { outcome: "accepted" })).toBe(2);
    expect(m.gaugeValue("zombie_active_matches")).toBe(3);
  });

  it("escapes label values so a hostile string cannot break the exposition", () => {
    const m = new Metrics();
    m.increment("zombie_test_total", { reason: 'a"b\nc' });
    expect(m.render()).toContain('zombie_test_total{reason="a_b_c"} 1');
  });
});
