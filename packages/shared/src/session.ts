import { SignJWT, jwtVerify } from "jose";

// Shared between apps/web (signs the session cookie + short-lived socket
// tokens) and apps/ws (verifies socket tokens only) so both processes agree
// on token format without duplicating the jose calls.
export const SESSION_COOKIE_NAME = "wamock_session";

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(
  claims: { sub: string; conversations?: string[] },
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT({ sub: claims.sub, conversations: claims.conversations })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(encodeSecret(secret));
}

export type VerifiedSession = { userId: string; conversations: string[] };

export async function verifySessionToken(token: string, secret: string): Promise<VerifiedSession | null> {
  try {
    const { payload } = await jwtVerify(token, encodeSecret(secret));
    if (typeof payload.sub !== "string") return null;
    const conversations = Array.isArray(payload.conversations)
      ? payload.conversations.filter((c): c is string => typeof c === "string")
      : [];
    return { userId: payload.sub, conversations };
  } catch {
    return null;
  }
}
