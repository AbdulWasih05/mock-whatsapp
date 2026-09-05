// Keyset pagination cursor: base64url of `${createdAt.toISOString()}|${id}`
// (CLAUDE.md §3). Isomorphic on purpose — the server mints cursors for
// backward paging, and the client mints one from its newest known message
// for reconnect gap-fill, so both sides must agree byte for byte.
// btoa/atob are globals in browsers and in Node >= 16, so no Buffer (and no
// Node type dependency) is needed in this isomorphic package.
function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeCursor(createdAt: Date | string, id: string): string {
  const iso = typeof createdAt === "string" ? createdAt : createdAt.toISOString();
  return toBase64Url(`${iso}|${id}`);
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const decoded = fromBase64Url(cursor);
    const sepIndex = decoded.lastIndexOf("|");
    if (sepIndex === -1) return null;
    const iso = decoded.slice(0, sepIndex);
    const id = decoded.slice(sepIndex + 1);
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
