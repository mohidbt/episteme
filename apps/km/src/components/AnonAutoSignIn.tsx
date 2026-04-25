"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@episteme/auth/client";

// Module-level singleton: dedupes StrictMode double-mount and any other
// concurrent mount path. The first call to `signIn.anonymous()` is cached
// here; subsequent mounts await the same Promise instead of firing a second
// sign-in (which would create a second anon user + duplicate seed).
let inFlight: Promise<unknown> | null = null;

// Test-only seam — production code never resets this.
export function __resetInFlightForTests() {
  inFlight = null;
}

export function AnonAutoSignIn() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    if (!inFlight) inFlight = signIn.anonymous();
    inFlight
      .then(() => {
        if (!cancelled) router.refresh();
      })
      .catch(() => {
        // Leave inFlight set to its rejected state; explicit retry is
        // out of scope for this component.
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="flex h-dvh items-center justify-center text-muted-foreground text-sm">
      Setting up your workspace…
    </div>
  );
}
