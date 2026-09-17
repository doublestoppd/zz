import type { GameEvent, GameState, ItemId, PlayerId, Position, ZombieId } from "@zombie/game-core";

export type SoundName =
  | "step"
  | "shot"
  | "hit"
  | "heal"
  | "pickup"
  | "reload"
  | "zombie"
  | "your_turn"
  | "victory"
  | "defeat";

/**
 * What the board should show for a batch of events, in order. Pure data so it can be
 * tested without Phaser; `BoardRenderer` turns each step into tweens and sounds.
 */
export type AnimationStep =
  | {
      readonly kind: "move";
      readonly entityId: PlayerId | ZombieId;
      readonly path: readonly Position[];
    }
  | { readonly kind: "shot"; readonly from: Position; readonly to: Position }
  | {
      readonly kind: "flash";
      readonly entityId: PlayerId | ZombieId;
      readonly tone: "damage" | "heal";
    }
  | { readonly kind: "vanish"; readonly entityId: ZombieId | ItemId }
  | { readonly kind: "sound"; readonly name: SoundName };

function positionOf(state: GameState, id: PlayerId | ZombieId): Position | undefined {
  return (
    state.players.find((p) => p.id === id)?.position ??
    state.zombies.find((z) => z.id === id)?.position
  );
}

/**
 * Builds the animation steps for `events`. `before` is the snapshot the board currently
 * shows and `after` the one the events lead to; entities that died are looked up in `before`.
 */
export function planAnimations(
  events: readonly GameEvent[],
  before: GameState | undefined,
  after: GameState,
  me: PlayerId | undefined,
): AnimationStep[] {
  const steps: AnimationStep[] = [];
  for (const event of events) {
    switch (event.type) {
      case "player_moved":
        steps.push(
          { kind: "sound", name: "step" },
          { kind: "move", entityId: event.playerId, path: event.path },
        );
        break;
      case "zombie_moved":
        steps.push({ kind: "move", entityId: event.zombieId, path: [event.to] });
        break;
      case "weapon_fired": {
        const from = positionOf(after, event.playerId);
        const to = before === undefined ? undefined : positionOf(before, event.targetId);
        steps.push({ kind: "sound", name: "shot" });
        if (from !== undefined && to !== undefined) steps.push({ kind: "shot", from, to });
        break;
      }
      case "zombie_attacked":
        steps.push({ kind: "sound", name: "zombie" });
        break;
      case "entity_damaged":
        steps.push(
          { kind: "sound", name: "hit" },
          { kind: "flash", entityId: event.entityId, tone: "damage" },
        );
        break;
      case "entity_died":
        steps.push({ kind: "vanish", entityId: event.entityId });
        break;
      case "player_healed":
        steps.push(
          { kind: "sound", name: "heal" },
          { kind: "flash", entityId: event.playerId, tone: "heal" },
        );
        break;
      case "item_picked_up":
        steps.push({ kind: "sound", name: "pickup" }, { kind: "vanish", entityId: event.itemId });
        break;
      case "weapon_reloaded":
      case "ammo_gained":
        steps.push({ kind: "sound", name: "reload" });
        break;
      case "turn_started":
        if (event.playerId === me) steps.push({ kind: "sound", name: "your_turn" });
        break;
      case "match_ended":
        steps.push({ kind: "sound", name: event.outcome === "victory" ? "victory" : "defeat" });
        break;
      case "item_used":
      case "player_downed":
      case "turn_ended":
      case "round_started":
      case "phase_changed":
      case "player_presence_changed":
      case "extraction_progress":
        break;
    }
  }
  return steps;
}
