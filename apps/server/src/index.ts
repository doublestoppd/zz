import type { InvariantLevel } from "@zombie/game-core";
import { DEFAULT_MATCH_DEPENDENCIES, MatchRegistry } from "./lobby/MatchRegistry.js";
import { FileMatchStore } from "./persistence/matchStore.js";
import { metrics } from "./observability/metrics.js";
import { GAME_VERSION } from "./version.js";
import { log } from "./log.js";
import { startSocketServer } from "./net/socketServer.js";
import { handleClientMessage, handleDisconnect } from "./router.js";

const port = parsePort(process.env.PORT);
const staticDir = process.env.STATIC_DIR;
const stateDir = process.env.STATE_DIR;
const invariantLevel = parseInvariantLevel(process.env.INVARIANT_CHECKS);
const registry = new MatchRegistry({
  deps: { ...DEFAULT_MATCH_DEPENDENCIES, invariantLevel },
  ...(stateDir === undefined || stateDir === "" ? {} : { store: new FileMatchStore(stateDir) }),
});
const recovered = registry.restore();

/** `INVARIANT_CHECKS`: `critical` (default, cheap) or `full` (every check, for staging and soaks). */
function parseInvariantLevel(raw: string | undefined): InvariantLevel {
  if (raw === undefined || raw === "" || raw === "critical") return "critical";
  if (raw === "full") return "full";
  process.stderr.write(`INVARIANT_CHECKS must be "critical" or "full", got "${raw}"\n`);
  process.exit(1);
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 8080;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    log("error", "PORT must be an integer between 1 and 65535", { port: raw });
    process.exit(1);
  }
  return value;
}

const adminToken = process.env.ADMIN_TOKEN;
const diagnostics = registry.diagnostics();
metrics.set("zombie_process_start_time_seconds", Math.floor(Date.now() / 1000));

// Fail fast on a programming error the handlers did not catch: a corrupt process is worse
// than a restart, and every active match is checkpointed. The line carries what a log
// search needs to find the last commands before it.
process.on("uncaughtException", (error) => {
  metrics.increment("zombie_uncaught_exceptions_total");
  log("error", "uncaught exception", {
    category: "server",
    error: `${error.name}: ${error.message}`,
    stack: error.stack ?? null,
  });
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  metrics.increment("zombie_uncaught_exceptions_total");
  log("error", "unhandled rejection", { category: "server", reason: String(reason) });
});

const handle = await startSocketServer({
  port,
  ...(staticDir === undefined ? {} : { staticDir }),
  http: {
    metricsText: () => registry.metricsText(),
    ...(adminToken === undefined || adminToken === "" ? {} : { adminToken }),
    diagnostics,
    isReady: diagnostics.isReady,
  },
  onMessage: (session, message) => {
    handleClientMessage(registry, session, message);
  },
  onDisconnect: (session) => {
    handleDisconnect(registry, session);
  },
  log: (line) => {
    log("error", line, { category: "server" });
  },
});

log("info", "server listening", {
  category: "server",
  port: handle.port,
  adminEndpoints: adminToken !== undefined && adminToken !== "",
  staticDir: staticDir ?? null,
  stateDir: stateDir ?? null,
  gameVersion: GAME_VERSION,
  ...recovered,
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    log("info", "shutting down", { signal });
    // Every active match is already checkpointed after its last mutation; drain, tell the
    // players, then close the listener so the process exits with nothing ambiguous behind.
    const drained = registry.shutdown();
    void handle.close().then(() => {
      log("info", "shutdown complete", drained);
      process.exit(0);
    });
  });
}
