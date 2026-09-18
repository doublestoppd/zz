/**
 * Minimal timing harness: no dependency, wall-clock via `performance.now()`, warm-up runs
 * discarded, then either a fixed number of iterations or as many as fit in a time budget.
 * Reports the median (the number budgets are set from), p95, and the extremes.
 */
export interface Measurement {
  readonly name: string;
  readonly iterations: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly meanMs: number;
  /** A size or count the case reports alongside its timing (bytes, tiles, zombies). */
  readonly note?: string;
}

export interface MeasureOptions {
  readonly warmup?: number;
  /** Stop after this many iterations (default 50). */
  readonly iterations?: number;
  /** Stop earlier once this much time has been spent (default 2000 ms). */
  readonly budgetMs?: number;
  readonly note?: string;
}

export function measure(
  name: string,
  work: () => unknown,
  options: MeasureOptions = {},
): Measurement {
  const warmup = options.warmup ?? 3;
  const maxIterations = options.iterations ?? 50;
  const budgetMs = options.budgetMs ?? 2000;
  for (let i = 0; i < warmup; i += 1) work();
  const samples: number[] = [];
  const started = performance.now();
  while (samples.length < maxIterations && performance.now() - started < budgetMs) {
    const t0 = performance.now();
    work();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const at = (q: number) =>
    samples[Math.min(samples.length - 1, Math.floor(q * samples.length))] ?? 0;
  return {
    name,
    iterations: samples.length,
    medianMs: at(0.5),
    p95Ms: at(0.95),
    minMs: samples[0] ?? 0,
    maxMs: samples[samples.length - 1] ?? 0,
    meanMs: samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length),
    ...(options.note === undefined ? {} : { note: options.note }),
  };
}

export function formatTable(rows: readonly Measurement[]): string {
  const f = (n: number) => (n < 10 ? n.toFixed(3) : n < 100 ? n.toFixed(2) : n.toFixed(1));
  return [
    "| case | median ms | p95 ms | min ms | max ms | n | note |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map(
      (r) =>
        `| ${r.name} | ${f(r.medianMs)} | ${f(r.p95Ms)} | ${f(r.minMs)} | ${f(r.maxMs)} | ${r.iterations} | ${r.note ?? ""} |`,
    ),
  ].join("\n");
}
