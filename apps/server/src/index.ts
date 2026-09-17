import { MatchRegistry } from "./lobby/MatchRegistry.js";
import { startSocketServer } from "./net/socketServer.js";
import { handleClientMessage, handleDisconnect } from "./router.js";

const port = parsePort(process.env.PORT);
const registry = new MatchRegistry();

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 8080;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    console.error(`PORT must be an integer between 1 and 65535, got "${raw}"`);
    process.exit(1);
  }
  return value;
}

const handle = await startSocketServer({
  port,
  onMessage: (session, message) => {
    handleClientMessage(registry, session, message);
  },
  onDisconnect: (session) => {
    handleDisconnect(registry, session);
  },
  log: (line) => {
    console.error(line);
  },
});

console.log(`zombie server listening on ws://localhost:${handle.port}`);
