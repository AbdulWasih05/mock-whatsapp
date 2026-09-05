import { describe, expect, it } from "vitest";
import { normalizeForModeration } from "./normalize.js";
import { checkProfanity } from "./check.js";
import { ALLOWLIST } from "./lists.js";

describe("normalizeForModeration", () => {
  it("lowercases", () => {
    expect(normalizeForModeration("FUCK")).toBe("fuck");
  });

  it("strips combining diacritics after NFKD decomposition", () => {
    expect(normalizeForModeration("café")).toBe("cafe");
  });

  it("folds Cyrillic homoglyphs to their Latin visual equivalents", () => {
    expect(normalizeForModeration("сunt")).toBe("cunt"); // Cyrillic с
    expect(normalizeForModeration("аss")).toBe("ass"); // Cyrillic а; "ss" is a normal double letter, not collapsed
  });

  it("maps leet substitutions", () => {
    expect(normalizeForModeration("sh1t")).toBe("shit");
    expect(normalizeForModeration("5h1t")).toBe("shit");
    expect(normalizeForModeration("@ss")).toBe("ass"); // @ -> a; "ss" stays (only 2 repeats)
    expect(normalizeForModeration("sh!t")).toBe("shit");
    expect(normalizeForModeration("4n4l")).toBe("anal");
  });

  it("collapses runs of 3+ repeated characters (evasion), not ordinary double letters", () => {
    expect(normalizeForModeration("fuuuuck")).toBe("fuck");
    expect(normalizeForModeration("shhhhit")).toBe("shit");
    expect(normalizeForModeration("ass")).toBe("ass"); // a normal double letter must survive intact
  });

  it("preserves word boundaries instead of merging adjacent words", () => {
    // A naive "strip every separator" pass turns "as soon" into "assoon",
    // which contains the blocklist word "ass" — a false positive this
    // normalizer must not produce.
    expect(normalizeForModeration("as soon as possible")).toBe("as soon as possible");
  });

  it("strips punctuation separators", () => {
    expect(normalizeForModeration("f.u.c.k")).toBe("fuck");
    expect(normalizeForModeration("f-u-c-k")).toBe("fuck");
  });

  it("strips whitespace separators (spaced-out evasion)", () => {
    expect(normalizeForModeration("f u c k")).toBe("fuck");
  });

  it("leaves an ordinary word intact", () => {
    expect(normalizeForModeration("hello")).toBe("hello");
  });
});

describe("checkProfanity", () => {
  it("blocks a plain hit", () => {
    const result = checkProfanity("fuck you");
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.matchedTerm).toBe("fuck");
  });

  it("blocks regardless of casing", () => {
    expect(checkProfanity("FUCK you").blocked).toBe(true);
    expect(checkProfanity("FuCk you").blocked).toBe(true);
  });

  it("blocks spaced-out letters", () => {
    expect(checkProfanity("f u c k").blocked).toBe(true);
  });

  it("blocks dot-separated letters", () => {
    expect(checkProfanity("f.u.c.k").blocked).toBe(true);
  });

  it("blocks repeated-character evasion", () => {
    expect(checkProfanity("fuuuuck").blocked).toBe(true);
  });

  it("blocks leet-speak", () => {
    expect(checkProfanity("sh1t").blocked).toBe(true);
    expect(checkProfanity("5h1t").blocked).toBe(true);
    expect(checkProfanity("sh!t").blocked).toBe(true);
  });

  it("blocks a Cyrillic homoglyph substitution", () => {
    expect(checkProfanity("сunt").blocked).toBe(true); // Cyrillic с in place of "c"
  });

  it("passes ordinary clean text", () => {
    expect(checkProfanity("hey, are we still on for tonight?").blocked).toBe(false);
  });

  it.each(ALLOWLIST)("passes the allowlisted term %s cleanly", (term) => {
    expect(checkProfanity(term).blocked).toBe(false);
    expect(checkProfanity(`I really like ${term} a lot`).blocked).toBe(false);
  });

  it("still catches a real violation alongside an allowlisted word", () => {
    const result = checkProfanity("I live in Scunthorpe and you are a bitch");
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.matchedTerm).toBe("bitch");
  });

  it("blocks a standalone short blocklist word without over-matching a common substring created by word-merging", () => {
    expect(checkProfanity("that's a nice ass").blocked).toBe(true);
    expect(checkProfanity("as soon as possible").blocked).toBe(false);
  });

  it("known limitation: a word containing a blocklist substring but absent from the given allowlist still false-positives", () => {
    // "class" (unlike "classic") is not in CLAUDE.md's allowlist, and it
    // contains "ass" with no separator to strip — substring matching alone
    // can't distinguish this from a real hit. Documented in the README
    // rather than silently patched with an allowlist entry nobody asked for.
    expect(checkProfanity("can you pass the class roster").blocked).toBe(true);
  });

  it("does not false-positive on words that merely contain an allowlisted word as a prefix", () => {
    expect(checkProfanity("grapefruit is my favorite").blocked).toBe(false);
    expect(checkProfanity("seedless grapes are great").blocked).toBe(false);
  });

  it("is case-insensitive for allowlisted terms too", () => {
    expect(checkProfanity("Scunthorpe Council").blocked).toBe(false);
  });
});
