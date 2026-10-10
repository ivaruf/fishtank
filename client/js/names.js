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
//
// Two sets of lists, because the suggestion is offered in the player's own
// language: a Norwegian child rolls "Sultne Plask", an English one "Hungry
// Splash". Bokmål puts the adjective in its weak form in front of a name, the
// way it does for Lille My and Gamle Erik. The longest bokmål pairs are
// "Kaptein Rullestein" and "Kaptein Rumpetroll" at 18, exactly the field's
// maxlength - no longer word may join either list. Once rolled, a name is the player's own and is
// never translated again - it is what goes over the wire and onto the roster.
import { getLang } from "./i18n.js";
const FIRST_NB = Object.freeze([
  "Kaptein",
  "Herr",
  "Fru",
  "Baron",
  "Doktor",
  "Lille",
  "Store",
  "Gamle",
  "Unge",
  "Gale",
  "Lure",
  "Modige",
  "Heldige",
  "Svimle",
  "Sure",
  "Sultne",
  "Søvnige",
  "Kjappe",
]);
const SECOND_NB = Object.freeze([
  "Boble",
  "Gjelle",
  "Finne",
  "Skjell",
  "Napp",
  "Glefs",
  "Plask",
  "Guppy",
  "Ørekyt",
  "Snapper",
  "Værhår",
  "Rur",
  "Svømmefot",
  "Vingle",
  "Rullestein",
  "Rumpetroll",
  "Sardin",
  "Ansjos",
]);
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
const pair = () =>
  getLang() === "nb"
    ? `${pick(FIRST_NB)} ${pick(SECOND_NB)}`
    : `${pick(FIRST)} ${pick(SECOND)}`;
// `avoid` is the name already on screen, for the die on the menu: one pairing
// in 324 is the one you are looking at, and rolling it again reads as a button
// that did nothing. A handful of retries is cheaper than any bookkeeping, and
// bounded, so an impossible list - one word in each - still returns a name.
export const fishName = (avoid = "") => {
  let name = pair();
  for (let tries = 0; tries < 8 && name === avoid; tries++) name = pair();
  return name;
};
// The longest name either list can produce, so a caller can check its field
// has room without hard-coding a number that would go stale.
export const longestFishName = () =>
  Math.max(
    ...[
      [FIRST, SECOND],
      [FIRST_NB, SECOND_NB],
    ].map(
      ([first, second]) =>
        Math.max(...first.map((f) => f.length)) +
        1 +
        Math.max(...second.map((s) => s.length)),
    ),
  );
