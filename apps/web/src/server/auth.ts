import "server-only";
import { cookies } from "next/headers";
import { ApiError, SESSION_COOKIE_NAME, signSessionToken, verifySessionToken } from "@wamock/shared";
import { prisma } from "./db";

export const SESSION_COOKIE = SESSION_COOKIE_NAME;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const SOCKET_TOKEN_TTL_SECONDS = 120;

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return secret;
}

// Dev-only auth: no password flow, no OAuth (CLAUDE.md §0). The session is a
// signed JWT holding only userId; nothing else is trusted from the client.
export async function signSession(userId: string): Promise<string> {
  return signSessionToken({ sub: userId }, getSecret(), SESSION_TTL_SECONDS);
}

// Short-lived token handed to the browser only to authenticate the socket
// handshake — the ws service is cross-origin in production, so it can't rely
// on the httpOnly session cookie. Embeds the caller's conversation ids as a
// claim so apps/ws never needs its own DB access to know which rooms to join
// (CLAUDE.md's ws service is fanout-only).
export async function signSocketToken(userId: string, conversationIds: string[]): Promise<string> {
  return signSessionToken({ sub: userId, conversations: conversationIds }, getSecret(), SOCKET_TOKEN_TTL_SECONDS);
}

// Reads the session cookie in a Route Handler / Server Component context.
// Never reads userId from the request body — CLAUDE.md §7: "Never read a
// user id from the client."
export async function getSessionUserId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const verified = await verifySessionToken(token, getSecret());
  return verified?.userId ?? null;
}

export async function requireUserId(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) throw new ApiError("UNAUTHENTICATED", "Sign in required");
  return userId;
}

export async function requireUser() {
  const userId = await requireUserId();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError("UNAUTHENTICATED", "Session user no longer exists");
  return user;
}

export const SESSION_COOKIE_MAX_AGE = SESSION_TTL_SECONDS;
