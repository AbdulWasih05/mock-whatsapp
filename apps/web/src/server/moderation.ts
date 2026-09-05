import "server-only";
import { checkProfanity as sharedCheckProfanity } from "@wamock/shared";

// Chokepoint step 4 from CLAUDE.md §2 — profanity (Phase 4). Image
// moderation (step 5) is a full pipeline, not a single check — see
// image-pipeline.ts.
export const checkProfanity = sharedCheckProfanity;
