// A representative blocklist, not an exhaustive production wordlist — the
// point of this exercise is the normalization pipeline, not word-list
// coverage (CLAUDE.md §6: "the most legible proof of engineering care").
export const BLOCKLIST = ["fuck", "shit", "cunt", "ass", "cock", "anal", "rape", "bitch", "whore"];

// The Scunthorpe problem: these normalize-and-contain a blocked substring
// but are ordinary words. Checked (and masked out) before the blocklist
// scan so they never trigger a false positive.
export const ALLOWLIST = ["classic", "assassin", "cocktail", "scunthorpe", "analysis", "bass", "grape", "shitake"];
