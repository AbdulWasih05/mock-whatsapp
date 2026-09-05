import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@wamock/shared";
import { prisma } from "@/server/db";
import { signSession, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE } from "@/server/auth";
import { errorResponse } from "@/server/http";

// Demo-only sign-in: a closed set of seed accounts, never an arbitrary user
// id from the client (CLAUDE.md §7 — "Never read a user id from the client").
const DEMO_ACCOUNTS = {
  aisha: "aisha@example.com",
  rohan: "rohan@example.com",
} as const;

const BodySchema = z.object({
  as: z.enum(["aisha", "rohan"]),
});

export async function POST(request: Request) {
  try {
    const body = BodySchema.parse(await request.json());
    const email = DEMO_ACCOUNTS[body.as];
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new ApiError("VALIDATION_FAILED", "Demo account not seeded yet");

    const token = await signSession(user.id);
    const res = NextResponse.json({ id: user.id, name: user.name, avatarUrl: user.avatarUrl });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE,
    });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
