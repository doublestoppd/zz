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

const serverUrl: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? `ws://${location.hostname}:8080`;

const store = new ClientStore();
const connection = new GameConnection(serverUrl);
const sender = new CommandSender(connection, store);
const sounds = new SoundPlayer();

connection.onStatus((status) => {
  store.setConnection(status);
  // Back online with a remembered slot but no live identity: rejoin automatically.
  const saved = loadIdentity();
  if (status === "open" && store.get().me === undefined && saved !== undefined) {
    connection.send({
      t: "rejoin_match",
      matchCode: saved.matchCode,
      rejoinToken: saved.rejoinToken,
    });
  }
  if (status === "closed" && store.get().me !== undefined) {
    // The server will mark us absent; the next open re-sends rejoin_match.
    store.clearIdentity();
  }
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
