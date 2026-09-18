import { formatClientTable, runClientBenchmarks } from "./clientBench.js";

/** `pnpm --filter @zombie/client bench`: the client's pure per-update costs, in Node. */
console.log(formatClientTable(runClientBenchmarks()));
