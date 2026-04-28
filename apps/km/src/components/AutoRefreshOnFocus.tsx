"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Calls router.refresh() when the tab regains visibility or window
 * regains focus, so RSC pages (drive, sidebar, papers, etc.) reflect
 * mutations made elsewhere — other tabs, the agent, direct DB writes —
 * without a manual reload.
 */
export function AutoRefreshOnFocus() {
  const router = useRouter();
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const onFocus = () => router.refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [router]);
  return null;
}
