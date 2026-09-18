/**
 * In-process metrics with no dependency: counters, gauges, and small histograms, rendered
 * in the Prometheus text format at `/metrics`. Label values are escaped; names are fixed by
 * the code that records them (see docs/OPERATIONS.md, "Metrics").
 */
type Labels = Readonly<Record<string, string>>;

const HISTOGRAM_BUCKETS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000];

interface Histogram {
  count: number;
  sum: number;
  min: number;
  max: number;
  readonly buckets: number[];
}

function key(name: string, labels: Labels): string {
  const parts = Object.keys(labels)
    .sort()
    .map((k) => `${k}="${labels[k]?.replace(/["\\\n]/g, "_") ?? ""}"`);
  return parts.length === 0 ? name : `${name}{${parts.join(",")}}`;
}

export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, Histogram>();

  increment(name: string, labels: Labels = {}, by = 1): void {
    const k = key(name, labels);
    this.counters.set(k, (this.counters.get(k) ?? 0) + by);
  }

  set(name: string, value: number, labels: Labels = {}): void {
    this.gauges.set(key(name, labels), value);
  }

  observe(name: string, value: number, labels: Labels = {}): void {
    const k = key(name, labels);
    const h = this.histograms.get(k) ?? {
      count: 0,
      sum: 0,
      min: Number.POSITIVE_INFINITY,
      max: 0,
      buckets: HISTOGRAM_BUCKETS.map(() => 0),
    };
    h.count += 1;
    h.sum += value;
    h.min = Math.min(h.min, value);
    h.max = Math.max(h.max, value);
    HISTOGRAM_BUCKETS.forEach((bound, i) => {
      if (value <= bound) h.buckets[i] = (h.buckets[i] ?? 0) + 1;
    });
    this.histograms.set(k, h);
  }

  /** Runs `work`, records its wall-clock duration in milliseconds, and returns its result. */
  time<T>(name: string, labels: Labels, work: () => T): T {
    const started = performance.now();
    try {
      return work();
    } finally {
      this.observe(name, performance.now() - started, labels);
    }
  }

  counterValue(name: string, labels: Labels = {}): number {
    return this.counters.get(key(name, labels)) ?? 0;
  }

  gaugeValue(name: string, labels: Labels = {}): number {
    return this.gauges.get(key(name, labels)) ?? 0;
  }

  /** Prometheus text exposition (version 0.0.4). */
  render(): string {
    const lines: string[] = [];
    for (const [k, v] of [...this.counters].sort()) lines.push(`${k} ${v}`);
    for (const [k, v] of [...this.gauges].sort()) lines.push(`${k} ${v}`);
    for (const [k, h] of [...this.histograms].sort()) {
      const [name, labels] = splitKey(k);
      const withLabel = (extra: string): string =>
        labels === "" ? `${name}_bucket{${extra}}` : `${name}_bucket{${labels},${extra}}`;
      HISTOGRAM_BUCKETS.forEach((bound, i) => {
        lines.push(`${withLabel(`le="${bound}"`)} ${h.buckets[i] ?? 0}`);
      });
      lines.push(`${withLabel('le="+Inf"')} ${h.count}`);
      const suffix = labels === "" ? "" : `{${labels}}`;
      lines.push(`${name}_sum${suffix} ${h.sum}`);
      lines.push(`${name}_count${suffix} ${h.count}`);
      lines.push(`${name}_min${suffix} ${h.count === 0 ? 0 : h.min}`);
      lines.push(`${name}_max${suffix} ${h.max}`);
    }
    return `${lines.join("\n")}\n`;
  }

  /** Everything as plain JSON, for tests and ad-hoc inspection. */
  snapshot(): Record<string, number | Histogram> {
    const out: Record<string, number | Histogram> = {};
    for (const [k, v] of this.counters) out[k] = v;
    for (const [k, v] of this.gauges) out[k] = v;
    for (const [k, v] of this.histograms) out[k] = v;
    return out;
  }
}

function splitKey(k: string): [string, string] {
  const brace = k.indexOf("{");
  return brace === -1 ? [k, ""] : [k.slice(0, brace), k.slice(brace + 1, -1)];
}

/** The process-wide registry. Tests may construct their own `Metrics` instead. */
export const metrics = new Metrics();
