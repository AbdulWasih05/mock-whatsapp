import "server-only";
import { fileTypeFromBuffer } from "file-type";
import { ALLOWED_IMAGE_CONTENT_TYPES } from "@wamock/shared";
import { fetchObjectBuffer, promoteToMedia, deleteObject } from "./storage";
import { imageModerator } from "./image-moderation";

export type ImagePipelineResult =
  | { ok: true; mediaKey: string; width: number | null; height: number | null }
  | { ok: false; code: "INVALID_FILE_TYPE" | "IMAGE_REJECTED"; reason?: string };

// CLAUDE.md §6 steps 4-5. No code path returns "ok" without the object
// having been moved to media/ first, and no code path leaves an orphaned
// quarantine object behind.
export async function processQuarantinedImage(quarantineKey: string): Promise<ImagePipelineResult> {
  const buf = await fetchObjectBuffer(quarantineKey);

  const detected = await fileTypeFromBuffer(buf);
  const allowed = new Set<string>(ALLOWED_IMAGE_CONTENT_TYPES);
  if (!detected || !allowed.has(detected.mime)) {
    await deleteObject(quarantineKey);
    return { ok: false, code: "INVALID_FILE_TYPE" };
  }

  const moderation = await imageModerator.check(buf);
  if (!moderation.safe) {
    await deleteObject(quarantineKey);
    return { ok: false, code: "IMAGE_REJECTED", reason: moderation.reason };
  }

  const mediaKey = await promoteToMedia(quarantineKey);

  let width: number | null = null;
  let height: number | null = null;
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(buf).metadata();
    width = meta.width ?? null;
    height = meta.height ?? null;
  } catch {
    // Dimensions are cosmetic (fixed-size rendering); a metadata failure
    // shouldn't fail an otherwise-safe, already-promoted upload.
  }

  return { ok: true, mediaKey, width, height };
}
