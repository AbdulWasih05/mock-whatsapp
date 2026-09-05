import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError } from "@wamock/shared";

// Single place every route handler funnels errors through, so the envelope
// shape in CLAUDE.md §4 is enforced by one function instead of by convention.
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(err.toBody(), { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.flatten() } },
      { status: 400 },
    );
  }
  // Anything else is a bug, not a designed outcome — it falls outside the
  // closed error-code contract on purpose, and gets logged for triage.
  console.error(err);
  return NextResponse.json(
    { error: { code: "VALIDATION_FAILED", message: "Internal server error" } },
    { status: 500 },
  );
}
