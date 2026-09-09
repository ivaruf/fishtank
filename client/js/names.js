// A name for a player who has not typed one.
//
// It goes in the name field as its placeholder, so it vanishes the moment
// anyone types, and it is what gets sent if they never do. That second half is
// the point: the field's placeholder used to be "Little fish" and so was the
// fallback behind it, which meant a tank of people who had not bothered was a
// tank of fish all called Little fish - unreadable on the roster, and no fun
// for the one player who did type something.
//
// Two lists rather than a list of finished names: 18 by 18 is 324 of them for
// 36 words, and every pairing reads as a name a child would give a fish. The
// longest possible pair is "Captain Whiskers" at 16 characters, inside the
// field's own maxlength of 18 - keep it that way when adding words, or the
// placeholder will suggest a name the field cannot hold.
const FIRST = Object.freeze([
  "Captain",
  "Sir",
  "Lady",
  "Baron",
  "Doctor",
  "Little",
  "Big",
  "Old",
  "Young",
  "Mad",
  "Sneaky",
  "Brave",
  "Lucky",
  "Dizzy",
  "Grumpy",
  "Hungry",
  "Sleepy",
  "Speedy",
]);
const SECOND = Object.freeze([
  "Bubbles",
  "Gills",
  "Fins",
  "Scales",
  "Nibbles",
  "Chomp",
  "Splash",
  "Guppy",
  "Minnow",
  "Snapper",
  "Whiskers",
  "Barnacle",
  "Flipper",
  "Wobbles",
  "Pebble",
  "Tadpole",
  "Sardine",
  "Anchovy",
]);
// Unseeded on purpose: nothing has to reproduce this, and a fish called the
// same thing every time you open the game is not a surprise twice.
const pick = (list) => list[Math.floor(Math.random() * list.length)];
export const fishName = () => `${pick(FIRST)} ${pick(SECOND)}`;
// The longest name either list can produce, so a caller can check its field
// has room without hard-coding a number that would go stale.
export const longestFishName = () =>
  Math.max(...FIRST.map((f) => f.length)) +
  1 +
  Math.max(...SECOND.map((s) => s.length));
