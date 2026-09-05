import { io, type Socket } from "socket.io-client";

async function fetchSocketToken(): Promise<string> {
  const res = await fetch("/api/auth/socket-token");
  const data: { token: string } = await res.json();
  return data.token;
}

// One socket per browser tab. `auth` as a function is re-invoked by
// socket.io-client on every (re)connect, so a fresh short-lived token is
// fetched each time rather than going stale after the first handshake.
export function createSocket(): Socket {
  const url = process.env.NEXT_PUBLIC_WS_URL;
  if (!url) throw new Error("NEXT_PUBLIC_WS_URL is not set");

  return io(url, {
    autoConnect: true,
    auth: (cb) => {
      fetchSocketToken()
        .then((token) => cb({ token }))
        .catch(() => cb({ token: "" }));
    },
  });
}
