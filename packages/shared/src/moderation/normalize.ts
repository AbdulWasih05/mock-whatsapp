// Pure normalizer — CLAUDE.md §6, in order:
//   1. lowercase
//   2. NFKD normalize, strip combining diacritics
//   3. fold homoglyphs (Cyrillic а/о/е/р/с → Latin visual equivalents)
//   4. leet map
//   5. collapse repeated character runs (fuuuuck → fuck)
//   6. strip non-alphanumeric separators (f.u.c.k → fuck, "f u c k" → fuck)
//
// Two deliberate departures from the naive version of steps 5-6, found by
// tracing false positives before shipping this:
//
// - Step 5 only collapses runs of 3+ identical characters, not 2+. A 2+
//   threshold shrinks "ass" (a legitimate blocklist word, spelled with a
//   normal double letter) down to "as" — a substring so common
//   ("as soon as possible") it would false-positive constantly. 3+ still
//   catches the spec's own example ("fuuuuck" has 4 u's) without touching
//   ordinary double letters.
// - Step 6 does not blanket-strip every separator into nothing. Doing that
//   merges adjacent WORDS across a space ("as soon" -> "assoon", which
//   contains "ass"), not just the spaced-out single LETTERS the step is
//   meant to catch ("f u c k"). Instead, tokens are rejoined with a single
//   space, except runs of consecutive single-character tokens (exactly the
//   "letters separated one at a time" evasion), which are glued together.
const COMBINING_DIACRITICS = /[̀-ͯ]/g;
const REPEATED_RUN = /(.)\1{2,}/g;
const NON_ALNUM_RUN = /[^a-z0-9]+/g;

const HOMOGLYPH_MAP: Record<string, string> = {
  а: "a", // U+0430 CYRILLIC SMALL LETTER A
  о: "o", // U+043E CYRILLIC SMALL LETTER O
  е: "e", // U+0435 CYRILLIC SMALL LETTER IE
  р: "p", // U+0440 CYRILLIC SMALL LETTER ER (visually "p")
  с: "c", // U+0441 CYRILLIC SMALL LETTER ES (visually "c")
};

const LEET_MAP: Record<string, string> = {
  "4": "a",
  "3": "e",
  "1": "i",
  "!": "i",
  "0": "o",
  $: "s",
  "@": "a",
  "5": "s",
  "7": "t",
};

function joinPreservingWordBoundaries(tokens: string[]): string {
  let result = "";
  let i = 0;
  while (i < tokens.length) {
    let segment = tokens[i]!;
    if (segment.length === 1) {
      let j = i + 1;
      while (j < tokens.length && tokens[j]!.length === 1) {
        segment += tokens[j];
        j++;
      }
      i = j;
    } else {
      i++;
    }
    result += (result ? " " : "") + segment;
  }
  return result;
}

export function normalizeForModeration(input: string): string {
  let s = input.toLowerCase();

  s = s.normalize("NFKD").replace(COMBINING_DIACRITICS, "");

  s = Array.from(s)
    .map((ch) => HOMOGLYPH_MAP[ch] ?? ch)
    .join("");

  s = Array.from(s)
    .map((ch) => LEET_MAP[ch] ?? ch)
    .join("");

  s = s.replace(REPEATED_RUN, "$1");

  const tokens = s.split(NON_ALNUM_RUN).filter(Boolean);
  return joinPreservingWordBoundaries(tokens);
}
