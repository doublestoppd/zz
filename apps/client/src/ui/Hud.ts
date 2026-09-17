import type { CommandSender } from "../net/CommandSender.js";
import type { ClientState, ClientStore } from "../state/ClientStore.js";
import { button, el, requireElement } from "./dom.js";
import { REJECTION_MESSAGES } from "./rejectionMessages.js";

/** Round, turn, action points, end-turn control, and the event log. */
export class Hud {
  private readonly root = requireElement("hud");
  private readonly matchSection = requireElement("match");
  private readonly roundLine = el("div");
  private readonly turnLine = el("div");
  private readonly playerList = el("ul", { className: "players" });
  private readonly endTurnButton: HTMLButtonElement;
  private readonly messageLine = el("div", { className: "error" });
  private readonly log = el("ul", { className: "log" });

  constructor(store: ClientStore, sender: CommandSender) {
    this.endTurnButton = button("End turn", () => {
      sender.send({ type: "end_turn" });
    });
    this.root.append(
      this.roundLine,
      this.turnLine,
      this.playerList,
      this.endTurnButton,
      this.messageLine,
      el("h3", { textContent: "Log" }),
      this.log,
    );
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

    this.roundLine.textContent = `Round ${game.round}`;
    this.turnLine.textContent =
      game.phase.kind === "finished"
        ? `Match over: ${game.phase.outcome}`
        : active === me
          ? "Your turn"
          : `${activeName}'s turn`;

    this.playerList.replaceChildren(
      ...game.players.map((p) =>
        el("li", {
          className: [p.id === active ? "active" : "", p.present ? "" : "absent"].join(" "),
          textContent: `${p.name}${p.id === me ? " (you)" : ""}: ${p.actionPoints}/${p.maxActionPoints} AP, ${p.health}/${p.maxHealth} HP`,
        }),
      ),
    );
    this.endTurnButton.disabled = active !== me || state.pendingSeq !== undefined;
    this.messageLine.textContent =
      state.lastRejection !== undefined
        ? REJECTION_MESSAGES[state.lastRejection]
        : (state.lastError ?? "");

    this.log.replaceChildren(
      ...state.log.filter((line) => line !== "").map((line) => el("li", { textContent: line })),
    );
    this.log.scrollTop = this.log.scrollHeight;
  }
}
