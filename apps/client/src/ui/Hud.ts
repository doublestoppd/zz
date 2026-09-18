import {
  AMMO_TYPES,
  barrierOptions,
  firearmOf,
  ITEM_TYPES,
  itemsUnderPlayer,
  legalMeleeTargets,
  meleeWeaponOf,
  searchableContainersInReach,
  type Barrier,
  type BarrierOptions,
  type GameState,
  type ItemType,
  type PlayerState,
} from "@zombie/game-core";
import type { SoundPlayer } from "../audio/SoundPlayer.js";
import { KEY_HELP } from "../input/keyboard.js";
import type { CommandSender } from "../net/CommandSender.js";
import type { GameConnection } from "../net/GameConnection.js";
import type { ClientState, ClientStore } from "../state/ClientStore.js";
import { clearIdentity } from "./identityStorage.js";
import { AMMO_LABELS } from "./eventLog.js";
import { describeObjective, describeOutcome } from "./objectiveText.js";
import { button, el, requireElement } from "./dom.js";
import { REJECTION_MESSAGES } from "./rejectionMessages.js";

/** How long a rejection stays on screen before it clears itself. */
const REJECTION_MESSAGE_MS = 3000;

/** Button text per item type; the compiler demands an entry for every `ItemType`. */
const ITEM_USE_LABELS: Readonly<Record<ItemType, string>> = {
  bandage: "Use bandage",
  medkit: "Use medkit",
  ammo_box: "Open ammo box",
  shell_box: "Open box of shells",
  rifle_clip: "Load rifle clip into reserve",
  key: "Use key",
  radio_parts: "Radio parts",
  pistol: "Pistol",
  shotgun: "Shotgun",
  rifle: "Rifle",
  knife: "Knife",
  bat: "Bat",
};

/** One phrase per threat level, from quiet to desperate. */
const THREAT_LABELS: readonly string[] = [
  "Quiet streets",
  "Stirring",
  "Restless",
  "Swarming",
  "Overrun",
];

/** Item types whose button never shows: they act through another command. */
function isPassiveItem(game: GameState, type: ItemType): boolean {
  const kind = game.rules.itemDefinitions[type].effect.kind;
  return kind !== "heal" && kind !== "ammo";
}

/** Round, turn, action points, end-turn control, and the event log. */
export class Hud {
  private readonly root = requireElement("hud");
  private readonly matchSection = requireElement("match");
  private readonly roundLine = el("div");
  private readonly threatLine = el("div");
  private readonly turnLine = el("div");
  private readonly objectiveLine = el("div");
  private readonly outcomeBanner = el("div", { className: "outcome" });
  private readonly backButton: HTMLButtonElement;
  private readonly playerList = el("ul", { className: "players" });
  private readonly weaponLine = el("div");
  private readonly ammoLine = el("div");
  private readonly meleeButton: HTMLButtonElement;
  private readonly inventoryLine = el("div");
  private readonly pickUpButton: HTMLButtonElement;
  private readonly searchButton: HTMLButtonElement;
  private readonly openDoorButton: HTMLButtonElement;
  private readonly closeDoorButton: HTMLButtonElement;
  private readonly forceEntryButton: HTMLButtonElement;
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
    this.meleeButton = button("Melee", () => {
      const me = currentPlayer(store.get());
      const target = me === undefined ? undefined : legalMeleeTargets(me.game, me.player)[0];
      if (target !== undefined) sender.send({ type: "melee_attack", targetId: target.id });
    });
    this.searchButton = button("Search", () => {
      const client = store.get();
      const me = client.game?.state.players.find((p) => p.id === client.me?.playerId);
      const container =
        me === undefined || client.game === undefined
          ? undefined
          : searchableContainersInReach(client.game.state, me)[0];
      if (container !== undefined) sender.send({ type: "search", containerId: container.id });
    });
    const barrierIn = (pick: (o: BarrierOptions) => Barrier | undefined): Barrier | undefined => {
      const me = currentPlayer(store.get());
      return me === undefined ? undefined : pick(barrierOptions(me.game, me.player));
    };
    this.openDoorButton = button("Open door", () => {
      const door = barrierIn((o) => o.open[0]);
      if (door !== undefined) sender.send({ type: "open_door", barrierId: door.id });
    });
    this.closeDoorButton = button("Close door", () => {
      const door = barrierIn((o) => o.close[0]);
      if (door !== undefined) sender.send({ type: "close_door", barrierId: door.id });
    });
    this.forceEntryButton = button("Force entry", () => {
      const barrier = barrierIn((o) => o.force[0]);
      if (barrier !== undefined) sender.send({ type: "force_entry", barrierId: barrier.id });
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
    for (const type of ITEM_TYPES) {
      const label = ITEM_USE_LABELS[type];
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
      this.threatLine,
      this.turnLine,
      this.objectiveLine,
      this.playerList,
      this.weaponLine,
      this.ammoLine,
      this.inventoryLine,
      el("div", {}, [
        this.searchButton,
        " ",
        this.pickUpButton,
        " ",
        ...[...this.useButtons.values()].flatMap((b) => [b, " "]),
      ]),
      el("div", {}, [this.openDoorButton, " ", this.closeDoorButton, " ", this.forceEntryButton]),
      el("div", {}, [
        this.reloadButton,
        " ",
        this.meleeButton,
        " ",
        this.endTurnButton,
        " ",
        this.muteButton,
      ]),
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
      outcomeText.textContent = describeOutcome(game.objective, game.phase.outcome);
    }

    this.objectiveLine.textContent = finished ? "" : describeObjective(game);

    this.roundLine.textContent = `Round ${game.round}`;
    this.threatLine.textContent = `${THREAT_LABELS[game.threat] ?? "Threat"} (level ${game.threat}/${game.rules.threat.maxLevel}): rises every ${game.rules.threat.roundsPerLevel} rounds, with noise, and with each objective step`;
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
          textContent: `${p.name}${p.id === me ? " (you)" : ""} (${game.rules.specialtyDefinitions[p.specialty].name.toLowerCase()}): ${p.actionPoints}/${p.maxActionPoints} AP, ${p.health}/${p.maxHealth} HP${p.status === "down" ? " (down)" : ""}`,
        }),
      ),
    );
    const mine = game.players.find((p) => p.id === me);
    if (mine === undefined) {
      this.weaponLine.textContent = "";
      this.ammoLine.textContent = "";
    } else {
      const firearm = firearmOf(game, mine);
      const melee = meleeWeaponOf(game, mine);
      this.weaponLine.textContent = `${mine.weapon.type}: ${mine.weapon.loadedAmmo}/${firearm.magazineSize} loaded, range ${firearm.range}, ${firearm.attackActionPointCost} AP a shot. ${mine.meleeWeapon}: ${melee.damage} damage, ${melee.attackActionPointCost} AP a strike.`;
      this.ammoLine.textContent = `Reserve: ${AMMO_TYPES.map((t) => `${mine.reserveAmmo[t]} ${AMMO_LABELS[t]}`).join(", ")}`;
    }
    const busy = active !== me || state.pendingSeq !== undefined;
    this.reloadButton.disabled = busy;
    const meleeTargets = mine === undefined ? [] : legalMeleeTargets(game, mine);
    this.meleeButton.disabled = busy || meleeTargets.length === 0;
    this.meleeButton.textContent =
      mine === undefined
        ? "Melee"
        : `Strike with ${mine.meleeWeapon} (${meleeWeaponOf(game, mine).attackActionPointCost} AP)`;
    this.endTurnButton.disabled = busy;
    const reachable = mine === undefined ? [] : searchableContainersInReach(game, mine);
    this.searchButton.disabled = busy || reachable.length === 0;
    this.searchButton.textContent =
      reachable.length === 0
        ? "Search"
        : `Search ${reachable[0]?.category ?? ""} cabinet (${game.rules.searchActionPointCost} AP)`;
    const doors =
      mine === undefined ? { open: [], close: [], force: [] } : barrierOptions(game, mine);
    this.openDoorButton.disabled = busy || doors.open.length === 0;
    this.openDoorButton.textContent =
      doors.open[0]?.state === "locked"
        ? `Unlock door with key (${game.rules.openDoorActionPointCost} AP)`
        : `Open door (${game.rules.openDoorActionPointCost} AP)`;
    this.closeDoorButton.disabled = busy || doors.close.length === 0;
    this.closeDoorButton.textContent = `Close door (${game.rules.closeDoorActionPointCost} AP)`;
    this.forceEntryButton.disabled = busy || doors.force.length === 0;
    this.forceEntryButton.textContent = `Force ${doors.force[0]?.kind ?? "entry"} (${game.rules.forceEntryActionPointCost} AP, loud)`;
    const underfoot = mine === undefined ? [] : itemsUnderPlayer(game, mine);
    this.pickUpButton.disabled = busy || underfoot.length === 0;
    const first = underfoot[0];
    this.pickUpButton.textContent =
      first === undefined
        ? "Pick up"
        : game.rules.itemDefinitions[first.type].effect.kind === "weapon"
          ? `Take ${first.type} (swap, ${game.rules.pickUpActionPointCost} AP)`
          : `Pick up ${first.type.replace("_", " ")}`;
    const carried = mine?.inventory ?? [];
    this.inventoryLine.textContent =
      mine === undefined
        ? ""
        : `Carrying (${carried.length}/${mine.inventoryCapacity}): ${carried.length === 0 ? "nothing" : carried.map((i) => i.replace("_", " ")).join(", ")}`;
    for (const [type, useButton] of this.useButtons) {
      // Keys and weapons have no use of their own (doors and pick-up handle them).
      useButton.hidden = !carried.includes(type) || isPassiveItem(game, type);
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
      }, REJECTION_MESSAGE_MS);
    }

    this.log.replaceChildren(
      ...state.log.filter((line) => line !== "").map((line) => el("li", { textContent: line })),
    );
    this.log.scrollTop = this.log.scrollHeight;
  }
}

/** The viewer's own survivor together with the match state, when both exist. */
function currentPlayer(
  client: ClientState,
): { readonly game: GameState; readonly player: PlayerState } | undefined {
  const game = client.game?.state;
  const player = game?.players.find((p) => p.id === client.me?.playerId);
  return game === undefined || player === undefined ? undefined : { game, player };
}

function restartAnimation(element: HTMLElement): void {
  element.classList.remove("pulse");
  element.getBoundingClientRect();
  element.classList.add("pulse");
}
