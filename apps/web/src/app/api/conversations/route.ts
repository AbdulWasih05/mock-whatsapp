import { NextResponse } from "next/server";
import { requireUserId } from "@/server/auth";
import { listConversationsForUser } from "@/server/conversations";
import { errorResponse } from "@/server/http";

export async function GET() {
  try {
    const userId = await requireUserId();
    const result = await listConversationsForUser(userId);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
