import Phaser from "phaser";
import { CommandSender } from "./net/CommandSender.js";
import { GameConnection } from "./net/GameConnection.js";
import { MatchScene } from "./scenes/MatchScene.js";
import { ClientStore } from "./state/ClientStore.js";
import { requireElement } from "./ui/dom.js";
import { Hud } from "./ui/Hud.js";
import { clearIdentity, saveIdentity } from "./ui/identityStorage.js";
import { LobbyPanel } from "./ui/LobbyPanel.js";

const serverUrl: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? `ws://${location.hostname}:8080`;

const store = new ClientStore();
const connection = new GameConnection(serverUrl);
const sender = new CommandSender(connection, store);

connection.onStatus((status) => {
  store.setConnection(status);
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
  if (
    message.t === "error" &&
    (message.code === "MATCH_NOT_FOUND" || message.code === "INVALID_REJOIN_TOKEN")
  ) {
    clearIdentity();
  }
});

const statusLine = requireElement("status");
store.subscribe((state) => {
  statusLine.textContent =
    state.connection === "open"
      ? `Connected to ${serverUrl}`
      : state.connection === "connecting"
        ? "Connecting..."
        : "Disconnected. Reload the page to reconnect, then use Rejoin.";
});

new LobbyPanel(store, connection);
new Hud(store, sender, connection);

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "board",
  width: 640,
  height: 400,
  backgroundColor: "#15171a",
  scene: [new MatchScene(store, sender)],
});

connection.connect();
