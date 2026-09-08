import test from "node:test";
import assert from "node:assert/strict";
import {
  CODE_LENGTH,
  SYMBOLS,
  newCode,
  parseCode,
  spellCode,
  symbolsOf,
} from "../client/js/codes.js";

test("a code is four pictures, and one code serves both ways in", () => {
  for (let i = 0; i < 200; i++) {
    const code = newCode();
    const symbols = symbolsOf(code);
    assert.equal(symbols.length, CODE_LENGTH);
    assert.ok(symbols.every(Boolean), `${code} is all pictures`);
    // Whatever is generated must survive the parser unchanged, or the code a
    // host shows is not the code a guest arrives at.
    assert.equal(parseCode(code), code);
    assert.equal(parseCode(spellCode(code)), code);
    assert.equal(parseCode(symbols.map((s) => s.icon).join("")), code);
  }
});

test("the parser forgives however the code was written down", () => {
  const code = "boat-fish-star-crab";
  for (const written of [
    "boat-fish-star-crab",
    "BOAT FISH STAR CRAB",
    "Boat, Fish, Star, Crab",
    "  boat   fish   star   crab  ",
    "boat/fish/star/crab",
    "⛵🐟⭐🦀",
    "⛵ 🐟 ⭐ 🦀",
    // Read down a phone and half remembered: every name is unique in its
    // first three letters, so a prefix is enough.
    "boa fis sta cra",
  ])
    assert.equal(parseCode(written), code, `"${written}" is the same room`);
});

test("the parser refuses what it cannot turn into a room", () => {
  for (const junk of ["", "   ", null, undefined, "fish", "fish-fish-fish"])
    assert.equal(
      parseCode(junk),
      null,
      `${JSON.stringify(junk)} is not a code`,
    );
  // A prefix may only shorten a name, never extend it.
  assert.equal(parseCode("boat fish star crabby"), null);
  // Ambiguous: "s" could be shark, shell or star, so it is not a guess worth
  // making - a wrong room is a worse outcome than being asked again.
  assert.equal(parseCode("s-s-s-s"), null);
  assert.equal(parseCode("sh-fish-star-crab"), null, "shark or shell?");
});

test("a code from another build is passed through, not rejected", () => {
  // The six-consonant codes this game used to hand out, so a guest on this
  // build can still join a friend who has not reloaded yet.
  assert.equal(parseCode("BFXK23"), "BFXK23");
  assert.equal(parseCode("bfxk23"), "BFXK23");
  assert.equal(spellCode("BFXK23"), "BFXK23", "and is not garbled on screen");
  assert.equal(parseCode("way too long to be any kind of code at all"), null);
});

test("every picture is distinct, and every name is prefix-unique", () => {
  assert.equal(new Set(SYMBOLS.map((s) => s.icon)).size, SYMBOLS.length);
  assert.equal(new Set(SYMBOLS.map((s) => s.name)).size, SYMBOLS.length);
  for (const s of SYMBOLS) {
    assert.match(s.name, /^[a-z]+$/, "names are plain lowercase words");
    const three = s.name.slice(0, 3);
    assert.equal(
      SYMBOLS.filter((o) => o.name.startsWith(three)).length,
      1,
      `${s.name} is not unique in its first three letters`,
    );
    // One code point per picture, so counting characters counts pictures and
    // a code renders at a predictable width.
    assert.equal([...s.icon].length, 1, `${s.name} is a single code point`);
  }
});
