import Phaser from "phaser";
import { SoundPlayer } from "./audio/SoundPlayer.js";
import { CommandSender } from "./net/CommandSender.js";
import { GameConnection } from "./net/GameConnection.js";
import { MatchScene } from "./scenes/MatchScene.js";
import { ClientStore } from "./state/ClientStore.js";
import { requireElement } from "./ui/dom.js";
import { Hud } from "./ui/Hud.js";
import { clearIdentity, loadIdentity, saveIdentity } from "./ui/identityStorage.js";
import { LobbyPanel } from "./ui/LobbyPanel.js";
import { GAME_VERSION, SOURCE_REVISION } from "./version.js";
import { PROTOCOL_VERSION } from "@zombie/protocol";
import { SIMULATION_VERSION } from "@zombie/game-core";

// One line a bug report can quote: what this page is running.
console.info(
  `zombie client ${GAME_VERSION} (protocol ${PROTOCOL_VERSION}, simulation ${SIMULATION_VERSION}, ${SOURCE_REVISION.slice(0, 12)})`,
);

/**
 * Where the game server is. Explicit VITE_SERVER_URL wins; the Vite dev server talks to the
 * default local port; a built client served by the game server uses its own origin.
 */
const serverUrl: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  (import.meta.env.DEV
    ? `ws://${location.hostname}:8080`
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);

const store = new ClientStore();
const connection = new GameConnection(serverUrl, GAME_VERSION);
const sender = new CommandSender(connection, store);
const sounds = new SoundPlayer();

connection.onStatus((status) => {
  store.setConnection(status);
  // Back online with a remembered slot: rejoin automatically. The match view stays on
  // screen through the outage; the server marks us absent and present again around it.
  const saved = loadIdentity();
  if (status === "open" && saved !== undefined) {
    connection.send({
      t: "rejoin_match",
      matchCode: saved.matchCode,
      rejoinToken: saved.rejoinToken,
    });
  }
  if (status === "closed") store.markDisconnected();
});
connection.onMessage((message) => {
  store.applyServerMessage(message);
  if (message.t === "joined")
    saveIdentity(
      store.get().me ?? {
        playerId: message.playerId,
        matchCode: message.matchCode,
        rejoinToken: message.rejoinToken,
      },
    );
  if (message.t === "error" && message.code === "VERSION_MISMATCH") {
    // This build cannot talk to the server any more; reconnecting would only repeat the
    // refusal. The status line tells the player to refresh.
    connection.stop();
    return;
  }
  if (
    message.t === "error" &&
    (message.code === "MATCH_NOT_FOUND" ||
      message.code === "INVALID_REJOIN_TOKEN" ||
      message.code === "SESSION_REPLACED")
  ) {
    // The slot is gone or belongs to another tab now: stop trying to rejoin it.
    clearIdentity();
    store.clearIdentity();
  }
});

const statusLine = requireElement("status");
store.subscribe((state) => {
  statusLine.textContent = state.versionMismatch
    ? "The game has been updated. Refresh to continue."
    : state.connection === "open"
      ? `Connected to ${serverUrl}` +
        (state.server === undefined
          ? ""
          : ` (server ${state.server.gameVersion}, client ${GAME_VERSION})`)
      : state.connection === "connecting"
        ? "Connecting..."
        : "Disconnected. Reconnecting...";
});

new LobbyPanel(store, connection);
new Hud(store, sender, connection, sounds);

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "board",
  width: 640,
  height: 400,
  backgroundColor: "#15171a",
  scene: [new MatchScene(store, sender, sounds)],
});

connection.connect();
