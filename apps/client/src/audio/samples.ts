import type { SoundName } from "../render/animationPlan.js";

/**
 * Recorded samples per sound, served from `public/assets/kenney/audio` (CC0, Kenney's
 * "RPG Audio", "Impact Sounds", "Interface Sounds", and "Music Jingles" packs;
 * docs/CREDITS.md). A sound with several files picks one at random each time so
 * footsteps do not machine-gun. A sound with no files stays a synthesised tone: the
 * packs have no gunshot or zombie growl worth the name, and a bad sample is worse than a
 * plain one.
 */
export const SAMPLES: Readonly<Record<SoundName, readonly string[]>> = {
  step: ["step_1", "step_2"],
  shot: [],
  hit: ["hit"],
  heal: ["heal"],
  pickup: ["pickup"],
  reload: ["reload"],
  zombie: [],
  door: ["door_1", "door_2"],
  swing: ["swing"],
  crash: ["crash_1", "crash_2"],
  your_turn: ["your_turn"],
  victory: ["victory"],
  defeat: ["defeat"],
};

export const SAMPLE_ROOT = "/assets/kenney/audio";

export function sampleUrl(file: string): string {
  return `${SAMPLE_ROOT}/${file}.ogg`;
}

/** Playback gain per sound, so a jingle does not drown a footstep. */
export const SAMPLE_GAIN: Readonly<Record<SoundName, number>> = {
  step: 0.35,
  shot: 1,
  hit: 0.7,
  heal: 0.6,
  pickup: 0.6,
  reload: 0.6,
  zombie: 1,
  door: 0.6,
  swing: 0.7,
  crash: 0.8,
  your_turn: 0.5,
  victory: 0.7,
  defeat: 0.7,
};
