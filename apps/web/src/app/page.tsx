"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// One-click demo sign-in: no password flow, no OAuth (CLAUDE.md §0/§8).
export default function Home() {
  const router = useRouter();
  const [pending, setPending] = useState<"aisha" | "rohan" | null>(null);

  async function signIn(as: "aisha" | "rohan") {
    setPending(as);
    const res = await fetch("/api/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ as }),
    });
    setPending(null);
    if (res.ok) router.push("/chat");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="flex flex-col items-center gap-1.5 text-center">
        <h1 className="text-xl font-medium">Sign in</h1>
        <p className="text-sm text-muted">Pick a demo account to continue</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          onClick={() => signIn("aisha")}
          disabled={pending !== null}
          className="rounded-xl border border-border px-6 py-3 text-sm font-medium hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
        >
          {pending === "aisha" ? "Signing in…" : "Sign in as Aisha"}
        </button>
        <button
          onClick={() => signIn("rohan")}
          disabled={pending !== null}
          className="rounded-xl border border-border px-6 py-3 text-sm font-medium hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
        >
          {pending === "rohan" ? "Signing in…" : "Sign in as Rohan"}
        </button>
      </div>

      <button
        onClick={() => window.open("/", "_blank")}
        className="rounded-md text-sm text-muted underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        Open second window
      </button>
    </div>
  );
}
