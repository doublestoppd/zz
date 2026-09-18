import { MatchRegistry } from "./lobby/MatchRegistry.js";
import { FileMatchStore } from "./persistence/matchStore.js";
import { GAME_VERSION } from "./version.js";
import { log } from "./log.js";
import { startSocketServer } from "./net/socketServer.js";
import { handleClientMessage, handleDisconnect } from "./router.js";

const port = parsePort(process.env.PORT);
const staticDir = process.env.STATIC_DIR;
const stateDir = process.env.STATE_DIR;
const registry = new MatchRegistry(
  stateDir === undefined || stateDir === "" ? {} : { store: new FileMatchStore(stateDir) },
);
const recovered = registry.restore();

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 8080;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    log("error", "PORT must be an integer between 1 and 65535", { port: raw });
    process.exit(1);
  }
  return value;
}

const handle = await startSocketServer({
  port,
  ...(staticDir === undefined ? {} : { staticDir }),
  onMessage: (session, message) => {
    handleClientMessage(registry, session, message);
  },
  onDisconnect: (session) => {
    handleDisconnect(registry, session);
  },
  log: (line) => {
    log("error", line);
  },
});

log("info", "server listening", {
  port: handle.port,
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
