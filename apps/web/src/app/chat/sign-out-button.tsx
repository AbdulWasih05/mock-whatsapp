"use client";

import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/sign-out", { method: "POST" });
        router.push("/");
      }}
      className="rounded-md text-sm text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      Sign out
    </button>
  );
}
