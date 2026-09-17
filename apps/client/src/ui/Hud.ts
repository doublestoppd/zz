import { isInExtractionZone, itemsUnderPlayer, type ItemType } from "@zombie/game-core";
import type { SoundPlayer } from "../audio/SoundPlayer.js";
import { KEY_HELP } from "../input/keyboard.js";
import type { CommandSender } from "../net/CommandSender.js";
import type { GameConnection } from "../net/GameConnection.js";
import type { ClientState, ClientStore } from "../state/ClientStore.js";
import { clearIdentity } from "./identityStorage.js";
import { button, el, requireElement } from "./dom.js";
import { REJECTION_MESSAGES } from "./rejectionMessages.js";

/** Round, turn, action points, end-turn control, and the event log. */
export class Hud {
  private readonly root = requireElement("hud");
  private readonly matchSection = requireElement("match");
  private readonly roundLine = el("div");
  private readonly turnLine = el("div");
  private readonly objectiveLine = el("div");
  private readonly outcomeBanner = el("div", { className: "outcome" });
  private readonly backButton: HTMLButtonElement;
  private readonly playerList = el("ul", { className: "players" });
  private readonly weaponLine = el("div");
  private readonly inventoryLine = el("div");
  private readonly pickUpButton: HTMLButtonElement;
  private readonly useButtons = new Map<ItemType, HTMLButtonElement>();
  private readonly reloadButton: HTMLButtonElement;
  private readonly endTurnButton: HTMLButtonElement;
  private readonly messageLine = el("div", { className: "error" });
  private readonly log = el("ul", { className: "log" });
  private readonly muteButton: HTMLButtonElement;
  private rejectionTimer: ReturnType<typeof setTimeout> | undefined;
  private wasMyTurn = false;

  constructor(
    private readonly store: ClientStore,
    sender: CommandSender,
    connection: GameConnection,
    sounds: SoundPlayer,
  ) {
    this.muteButton = button(sounds.isMuted() ? "Unmute" : "Mute", () => {
      sounds.setMuted(!sounds.isMuted());
    });
    sounds.onMuteChange((muted) => {
      this.muteButton.textContent = muted ? "Unmute" : "Mute";
    });
    this.muteButton.setAttribute("aria-label", "Toggle sound");
    this.backButton = button("Back to lobby", () => {
      connection.send({ t: "leave_match" });
      clearIdentity();
      store.clearIdentity();
    });
    this.reloadButton = button("Reload", () => {
      sender.send({ type: "reload" });
    });
    this.pickUpButton = button("Pick up", () => {
      const client = store.get();
      const me = client.game?.state.players.find((p) => p.id === client.me?.playerId);
      const item =
        me === undefined || client.game === undefined
          ? undefined
          : itemsUnderPlayer(client.game.state, me)[0];
      if (item !== undefined) sender.send({ type: "pick_up", itemId: item.id });
    });
    for (const [type, label] of [
      ["medkit", "Use medkit"],
      ["ammo_box", "Open ammo box"],
    ] as const) {
      this.useButtons.set(
        type,
        button(label, () => {
          sender.send({ type: "use_item", itemType: type });
        }),
      );
    }
    this.endTurnButton = button("End turn", () => {
      sender.send({ type: "end_turn" });
    });
    this.outcomeBanner.append(el("div", { id: "outcome-text" }), this.backButton);
    this.root.append(
      this.outcomeBanner,
      this.roundLine,
      this.turnLine,
      this.objectiveLine,
      this.playerList,
      this.weaponLine,
      this.inventoryLine,
      el("div", {}, [
        this.pickUpButton,
        " ",
        ...[...this.useButtons.values()].flatMap((b) => [b, " "]),
      ]),
      el("div", {}, [this.reloadButton, " ", this.endTurnButton, " ", this.muteButton]),
      this.messageLine,
      el("details", {}, [
        el("summary", { textContent: "Keyboard controls" }),
        el(
          "ul",
          { className: "help" },
          KEY_HELP.map(([key, what]) => el("li", { textContent: `${key}: ${what}` })),
        ),
      ]),
      el("h3", { textContent: "Log" }),
      this.log,
    );
    // Screen readers announce turn changes and rejections without reading the whole log.
    this.turnLine.setAttribute("aria-live", "polite");
    this.messageLine.setAttribute("aria-live", "assertive");
    this.log.setAttribute("aria-label", "Match log");
    store.subscribe((state) => {
      this.render(state);
    });
  }

  private render(state: ClientState): void {
    this.matchSection.hidden = state.game === undefined;
    if (state.game === undefined) return;
    const game = state.game.state;
    const me = state.me?.playerId;
    const active = game.phase.kind === "player_turn" ? game.phase.activePlayerId : undefined;
    const activeName = game.players.find((p) => p.id === active)?.name ?? "";

    const finished = game.phase.kind === "finished";
    this.outcomeBanner.hidden = !finished;
    const outcomeText = this.outcomeBanner.querySelector("#outcome-text");
    if (outcomeText !== null && game.phase.kind === "finished") {
      outcomeText.textContent =
        game.phase.outcome === "victory"
          ? "Extraction successful. Victory!"
          : "Everyone is down. Defeat.";
    }

    const standing = game.players.filter((p) => p.status === "active");
    const inZone = standing.filter((p) => isInExtractionZone(game.objective, p.position)).length;
    this.objectiveLine.textContent = finished
      ? ""
      : `Objective: get every standing survivor into the green zone (${inZone}/${standing.length} there)` +
        (game.objective.roundsHeld > 0
          ? `, held ${game.objective.roundsHeld}/${game.objective.holdoutRounds + 1} rounds`
          : game.objective.holdoutRounds > 0
            ? `, then hold it for ${game.objective.holdoutRounds} more round(s)`
            : "");

    this.roundLine.textContent = `Round ${game.round}`;
    const myTurn = active === me && !finished;
    this.turnLine.classList.toggle("your-turn", myTurn);
    if (myTurn && !this.wasMyTurn) {
      // Reading the layout forces a reflow so the CSS animation restarts.
      restartAnimation(this.turnLine);
    }
    this.wasMyTurn = myTurn;
    this.turnLine.textContent =
      game.phase.kind === "finished"
        ? `Match over: ${game.phase.outcome}`
        : active === me
          ? "Your turn"
          : `${activeName}'s turn`;

    this.playerList.replaceChildren(
      ...game.players.map((p) =>
        el("li", {
          className: [
            p.id === active ? "active" : "",
            p.present && p.status === "active" ? "" : "absent",
          ].join(" "),
          textContent: `${p.name}${p.id === me ? " (you)" : ""}: ${p.actionPoints}/${p.maxActionPoints} AP, ${p.health}/${p.maxHealth} HP${p.status === "down" ? " (down)" : ""}`,
        }),
      ),
    );
    const mine = game.players.find((p) => p.id === me);
    this.weaponLine.textContent =
      mine === undefined
        ? ""
        : `${mine.weapon.type}: ${mine.weapon.loadedAmmo}/${game.rules.weaponDefinitions[mine.weapon.type].magazineSize} loaded, ${mine.reserveAmmo} in reserve`;
    const busy = active !== me || state.pendingSeq !== undefined;
    this.reloadButton.disabled = busy;
    this.endTurnButton.disabled = busy;
    const underfoot = mine === undefined ? [] : itemsUnderPlayer(game, mine);
    this.pickUpButton.disabled = busy || underfoot.length === 0;
    this.pickUpButton.textContent =
      underfoot.length === 0 ? "Pick up" : `Pick up ${underfoot[0]?.type.replace("_", " ") ?? ""}`;
    const carried = mine?.inventory ?? [];
    this.inventoryLine.textContent =
      mine === undefined
        ? ""
        : `Carrying (${carried.length}/${mine.inventoryCapacity}): ${carried.length === 0 ? "nothing" : carried.map((i) => i.replace("_", " ")).join(", ")}`;
    for (const [type, useButton] of this.useButtons) {
      useButton.hidden = !carried.includes(type);
      useButton.disabled = busy;
    }
    this.messageLine.textContent =
      state.lastRejection !== undefined
        ? REJECTION_MESSAGES[state.lastRejection]
        : (state.lastError ?? "");
    if (state.lastRejection !== undefined && this.rejectionTimer === undefined) {
      this.rejectionTimer = setTimeout(() => {
        this.rejectionTimer = undefined;
        this.store.clearRejection();
      }, 3000);
    }

    this.log.replaceChildren(
      ...state.log.filter((line) => line !== "").map((line) => el("li", { textContent: line })),
    );
    this.log.scrollTop = this.log.scrollHeight;
  }
}

function restartAnimation(element: HTMLElement): void {
  element.classList.remove("pulse");
  element.getBoundingClientRect();
  element.classList.add("pulse");
}
