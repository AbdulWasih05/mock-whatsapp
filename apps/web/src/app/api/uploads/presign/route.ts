import { NextResponse } from "next/server";
import { PresignRequestSchema, ApiError, type PresignResponse } from "@wamock/shared";
import { requireUserId } from "@/server/auth";
import { checkRateLimit } from "@/server/rate-limit";
import { newQuarantineKey, presignUpload } from "@/server/storage";
import { errorResponse } from "@/server/http";

const PRESIGN_TTL_SECONDS = 60;

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();

    const rate = checkRateLimit(userId, "presign");
    if (rate.limited) throw new ApiError("RATE_LIMITED", "Too many upload requests, slow down");

    const { contentType, contentLength } = PresignRequestSchema.parse(await request.json());

    const key = newQuarantineKey();
    const uploadUrl = await presignUpload(key, contentType, contentLength);

    const response: PresignResponse = {
      uploadUrl,
      key,
      expiresAt: new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000).toISOString(),
    };
    return NextResponse.json(response);
  } catch (err) {
    return errorResponse(err);
  }
}
