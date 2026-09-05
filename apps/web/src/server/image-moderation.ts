import "server-only";
import sharp from "sharp";

export interface ImageModerator {
  check(buf: Buffer): Promise<{ safe: boolean; score: number; reason?: string }>;
}

// Naive heuristic, not a classifier — see README "Known limitations". High
// false-positive rate on close-up faces and beaches; skin-tone thresholding
// carries known demographic bias that alone disqualifies it for production.
// NSFWJS (MobileNetV2, ~2.4MB, ~200ms CPU) drops into this same interface as
// a one-file change; not shipped here for lack of time, not lack of a plan.
const SKIN_RATIO_THRESHOLD = 0.4;

export class SkinRatioModerator implements ImageModerator {
  async check(buf: Buffer): Promise<{ safe: boolean; score: number; reason?: string }> {
    const { data, info } = await sharp(buf)
      .resize(64, 64, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const totalPixels = info.width * info.height;
    let skinPixels = 0;

    for (let i = 0; i + 2 < data.length; i += info.channels) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;

      // ITU-R BT.601 RGB -> YCbCr (Y unused — only chroma matters for the
      // skin-tone range check).
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

      if (cr >= 133 && cr <= 173 && cb >= 77 && cb <= 127) skinPixels++;
    }

    const ratio = skinPixels / totalPixels;
    const safe = ratio <= SKIN_RATIO_THRESHOLD;
    return { safe, score: ratio, reason: safe ? undefined : `skin-tone pixel ratio ${ratio.toFixed(2)} over threshold` };
  }
}

export const imageModerator: ImageModerator = new SkinRatioModerator();
