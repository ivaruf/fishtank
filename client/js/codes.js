// Room codes made of pictures.
//
// A code used to be six consonants, which is fine to shout across a room and
// miserable for a seven-year-old with a tablet and no interest in typing. So a
// code is now four pictures, and the important part is that it is *one* code
// rather than two systems: "boat-fish-star-crab" is the thing a kid taps out
// on the dialpad and the thing a parent pastes into a chat. Nothing has to be
// translated between them, and a code read out loud over the phone is four
// ordinary words instead of "B, D as in delta, four, X...".
//
// Twelve pictures, four slots, so 20,736 codes. That is far more than enough:
// only rooms open at the same moment can collide, there are never more than a
// handful, and the rendezvous already says "that code is already in use" and
// hands out another. Four slots rather than three because tapping is the easy
// part - it is typing that was hard.
//
// Emoji, not artwork. They are already in the system font on every device that
// runs this, they need no download and no third party, and they read at a
// glance at any size. Everything here is Unicode 9 or older, so an old tablet
// shows a picture rather than a box. Twelve of them are also enough to be told
// apart at speed: no two share a silhouette or a colour, which matters more
// than variety when the point is tapping the right one quickly.
export const SYMBOLS = Object.freeze(
  [
    { name: "fish", icon: "🐟" },
    { name: "shark", icon: "🦈" },
    { name: "octopus", icon: "🐙" },
    { name: "crab", icon: "🦀" },
    { name: "dolphin", icon: "🐬" },
    { name: "whale", icon: "🐳" },
    { name: "shell", icon: "🐚" },
    { name: "star", icon: "⭐" },
    { name: "anchor", icon: "⚓" },
    { name: "boat", icon: "⛵" },
    { name: "turtle", icon: "🐢" },
    { name: "wave", icon: "🌊" },
  ].map(Object.freeze),
);
export const CODE_LENGTH = 4;
const byName = new Map(SYMBOLS.map((s) => [s.name, s]));
const byIcon = new Map(SYMBOLS.map((s) => [s.icon, s]));
export const newCode = () =>
  Array.from(
    { length: CODE_LENGTH },
    () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)].name,
  ).join("-");
// The pictures behind a code, for drawing it. Unknown words become null so a
// caller can still show what it does recognise.
export const symbolsOf = (code) =>
  String(code)
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map((word) => match(word) ?? null);
// Every name is unique in its first three letters, so a prefix is enough. That
// is not a convenience for the code, it is one for whoever is typing what they
// heard down a phone line - "octo", "oct" and "octopus" all arrive. Only
// shorter, though: forgiving extra letters too would start matching words
// nobody meant, and landing in the wrong room is worse than being asked again.
function match(word) {
  if (byName.has(word)) return byName.get(word);
  if (byIcon.has(word)) return byIcon.get(word);
  if (word.length < 2) return undefined;
  const hits = SYMBOLS.filter((s) => s.name.startsWith(word));
  return hits.length === 1 ? hits[0] : undefined;
}
// Read a code out of whatever the player typed, pasted or tapped. Separators,
// case and spelling-out are all forgiven: "Boat Fish Star Crab",
// "boat-fish-star-crab" and "⛵🐟⭐🦀" are the same room.
//
// What is not four pictures is refused, with one exception: the codes this
// game used to hand out, so a guest on this build can still join a friend
// still running the old one. That exception is written as narrowly as the old
// generator was - five to twelve characters, no vowels, none of the letters it
// left out - because the obvious loose version ("anything code-shaped") also
// swallowed "fish" and "sh-fish-star-crab", turning a half-typed picture code
// into a nonsense room and a confusing failure at the broker instead of a
// plain "that is not a code, try again".
const OLD_CODE = /^[BCDFGHJKLMNPQRSTVWXZ23456789]{5,12}$/i;
export function parseCode(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const icons = [...raw].filter((ch) => byIcon.has(ch));
  const words =
    icons.length === CODE_LENGTH
      ? icons.map((ch) => byIcon.get(ch))
      : raw
          .toLowerCase()
          .split(/[^a-z]+/)
          .filter(Boolean)
          .map(match);
  if (words.length === CODE_LENGTH && words.every(Boolean))
    return words.map((s) => s.name).join("-");
  return OLD_CODE.test(raw) ? raw.toUpperCase() : null;
}
// "boat-fish-star-crab" as "BOAT FISH STAR CRAB", for reading aloud and for
// pasting into a chat. A code that is not made of pictures - one passed
// through from an older build - is handed back as it came, since spelling out
// something this does not understand would only garble it.
export const spellCode = (code) => {
  const symbols = symbolsOf(code);
  return symbols.length && symbols.every(Boolean)
    ? symbols
        .map((s) => s.name)
        .join(" ")
        .toUpperCase()
    : String(code).toUpperCase();
};
