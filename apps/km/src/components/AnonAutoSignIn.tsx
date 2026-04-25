"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@episteme/auth/client";

export function AnonAutoSignIn() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await signIn.anonymous();
      if (!cancelled) router.refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);
  return null;
}
