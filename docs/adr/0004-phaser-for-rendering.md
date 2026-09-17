# 0004 — Phaser 3 for board rendering, DOM for lobby and HUD

Status: accepted

## Context

The client needs a 2D tile board with sprites, click input, and later animation, plus forms
and text panels for the lobby and HUD.

## Decision

Phaser 3 renders the board inside `apps/client/src/render` and `scenes`. Everything else
(lobby forms, HUD, log) is plain DOM built in `apps/client/src/ui`. Phaser is never imported
outside `render/` and `scenes/`.

## Alternatives considered

- PixiJS: lighter, but scene lifecycle, input, and tweens would be hand-written.
- Raw canvas: fine for tiles, but animation and input handling grow quickly.
- Phaser for the UI too: text inputs and lists are far easier in DOM.

## Consequences

- The client bundle is large (Phaser is about 1 MB minified); acceptable for a game.
- Rendering is a function of `GameState` (`BoardRenderer.render(state, me)`), so the board is
  always correct after any update even if an event was missed.
