import { SPECIALTY_TYPES, type SpecialtyType } from "@zombie/game-core";
import { SPECIALTY_DEFINITIONS } from "@zombie/game-data";
import { isValidPlayerName } from "@zombie/protocol";
import type { GameConnection } from "../net/GameConnection.js";
import type { ClientState, ClientStore } from "../state/ClientStore.js";
import { button, el, requireElement } from "./dom.js";
import { clearIdentity, loadIdentity } from "./identityStorage.js";

/**
 * Create / join / rejoin controls and the pre-match player list.
 * Hidden once the match starts.
 */
export class LobbyPanel {
  private readonly root = requireElement("lobby");
  private readonly nameInput = el("input");
  private readonly codeInput = el("input");
  private readonly specialtySelect = el("select");
  private readonly specialtyHelp = el("div", { className: "help" });
  private readonly errorLine = el("div", { className: "error" });
  private readonly playerList = el("ul", { className: "players" });
  private readonly startButton: HTMLButtonElement;
  private readonly rejoinButton: HTMLButtonElement;

  constructor(
    store: ClientStore,
    private readonly connection: GameConnection,
  ) {
    this.nameInput.placeholder = "Your name";
    this.nameInput.maxLength = 20;
    this.codeInput.placeholder = "Match code";
    this.codeInput.maxLength = 4;
    this.specialtySelect.setAttribute("aria-label", "Specialty");
    for (const type of SPECIALTY_TYPES) {
      const option = el("option", { textContent: SPECIALTY_DEFINITIONS[type].name });
      option.value = type;
      this.specialtySelect.append(option);
    }
    this.specialtySelect.addEventListener("change", () => {
      this.specialtyHelp.textContent = SPECIALTY_DEFINITIONS[this.specialty()].description;
      // In a lobby the change is sent at once; before joining it travels with the join.
      if (store.get().me !== undefined) {
        connection.send({ t: "set_specialty", specialty: this.specialty() });
      }
    });
    this.specialtyHelp.textContent = SPECIALTY_DEFINITIONS.survivor.description;
    this.startButton = button("Start match", () => {
      connection.send({ t: "start_match" });
    });
    this.rejoinButton = button("Rejoin previous match", () => {
      this.rejoin();
    });

    this.root.append(
      el("h1", { textContent: "Zombie Survival" }),
      this.nameInput,
      el("div", {}, [el("label", { textContent: "Specialty: " }), this.specialtySelect]),
      this.specialtyHelp,
      el("div", {}, [
        button("Create match", () => {
          this.create();
        }),
        " ",
        this.codeInput,
        button("Join", () => {
          this.join();
        }),
      ]),
      this.rejoinButton,
      this.errorLine,
      this.playerList,
      this.startButton,
      button("Leave", () => {
        connection.send({ t: "leave_match" });
        clearIdentity();
        store.clearIdentity();
      }),
    );
    store.subscribe((state) => {
      this.render(state);
    });
  }

  private create(): void {
    const playerName = this.nameInput.value.trim();
    if (!isValidPlayerName(playerName)) {
      this.errorLine.textContent = "Enter a name (1-20 characters).";
      return;
    }
    this.connection.send({ t: "create_match", playerName, specialty: this.specialty() });
  }

  private join(): void {
    const playerName = this.nameInput.value.trim();
    const matchCode = this.codeInput.value.trim().toUpperCase();
    if (!isValidPlayerName(playerName) || matchCode.length === 0) {
      this.errorLine.textContent = "Enter a name and a match code.";
      return;
    }
    this.connection.send({ t: "join_match", matchCode, playerName, specialty: this.specialty() });
  }

  private specialty(): SpecialtyType {
    const value = this.specialtySelect.value;
    return (SPECIALTY_TYPES as readonly string[]).includes(value)
      ? (value as SpecialtyType)
      : "survivor";
  }

  private rejoin(): void {
    const saved = loadIdentity();
    if (saved === undefined) return;
    this.connection.send({
      t: "rejoin_match",
      matchCode: saved.matchCode,
      rejoinToken: saved.rejoinToken,
    });
  }

  private render(state: ClientState): void {
    const inMatch = state.me !== undefined;
    const started = state.lobby?.started ?? false;
    this.root.hidden = started;
    this.nameInput.disabled = inMatch;
    this.codeInput.disabled = inMatch;
    this.specialtySelect.disabled = started;
    this.rejoinButton.hidden = inMatch || loadIdentity() === undefined;
    this.errorLine.textContent = state.lastError ?? "";

    this.playerList.replaceChildren();
    if (state.lobby !== undefined) {
      this.playerList.append(
        el("li", { textContent: `Match code: ${state.lobby.matchCode}` }),
        ...state.lobby.players.map((p) =>
          el("li", {
            className: p.present ? "" : "absent",
            textContent: `${p.name}, ${SPECIALTY_DEFINITIONS[p.specialty].name.toLowerCase()}${p.id === state.lobby?.hostId ? " (host)" : ""}${
              p.id === state.me?.playerId ? " (you)" : ""
            }`,
          }),
        ),
      );
    }
    const isHost = state.lobby !== undefined && state.lobby.hostId === state.me?.playerId;
    this.startButton.hidden = !isHost || started;
  }
}
