import { normalizeForModeration } from "./normalize.js";
import { ALLOWLIST, BLOCKLIST } from "./lists.js";

export type ProfanityResult = { blocked: false } | { blocked: true; matchedTerm: string };

// Allowlist terms are masked out of the normalized text *before* the
// blocklist scan, not just excluded as a whole-message exception — so
// "the scunthorpe council" doesn't trip on "cunt" (embedded in
// "scunthorpe") while a real hit elsewhere in the same message still
// blocks it (CLAUDE.md §6's Scunthorpe problem).
export function checkProfanity(text: string): ProfanityResult {
  const normalized = normalizeForModeration(text);

  let masked = normalized;
  for (const allowed of ALLOWLIST) {
    const normalizedAllowed = normalizeForModeration(allowed);
    masked = masked.split(normalizedAllowed).join(" ".repeat(normalizedAllowed.length));
  }

  for (const term of BLOCKLIST) {
    const normalizedTerm = normalizeForModeration(term);
    if (normalizedTerm && masked.includes(normalizedTerm)) {
      return { blocked: true, matchedTerm: term };
    }
  }

  return { blocked: false };
}
