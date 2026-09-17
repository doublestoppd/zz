import { MatchRegistry } from "./lobby/MatchRegistry.js";
import { startSocketServer } from "./net/socketServer.js";
import { handleClientMessage, handleDisconnect } from "./router.js";

const port = Number(process.env.PORT ?? 8080);
const registry = new MatchRegistry();

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
