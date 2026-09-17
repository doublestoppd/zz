import { MatchRegistry } from "./lobby/MatchRegistry.js";
import { log } from "./log.js";
import { startSocketServer } from "./net/socketServer.js";
import { handleClientMessage, handleDisconnect } from "./router.js";

const port = parsePort(process.env.PORT);
const staticDir = process.env.STATIC_DIR;
const registry = new MatchRegistry();

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

log("info", "server listening", { port: handle.port, staticDir: staticDir ?? null });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log("info", "shutting down", { signal });
    void handle.close().then(() => {
      process.exit(0);
    });
  });
}
