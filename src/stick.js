// The arena's stick figures: pose art and the gun constants the rules share. Pure: no DOM, no randomness.

export const SHOULDER = { dx: 0.15, dy: -0.3 };
export const HAND_R = 1.3;
export const MUZZLE_R = { deagle: 2.8, rifle: 4.8, sniper: 6.8 };
// hand is the index of the glyph at the hand.
export const GUN_ART = {
  deagle: { glyphs: '╦═', hand: 0 },
  rifle: { glyphs: '═╦╤══', hand: 1 },
  sniper: { glyphs: '═╦═°═══', hand: 1 },
};
