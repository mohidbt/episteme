"use client";

// GSD-11 — Full-screen mobile gate. Episteme is desktop-only for now; on
// narrow viewports we render a polite "please open on desktop" overlay
// instead of the actual app, so users don't waste time wrestling with a
// layout that isn't tuned for phones.
//
// Detection is intentionally simple: viewport width + a UA mobile hint.
// Either signal flips the gate on. Tablets in landscape (>= 768px) get
// through.
//
// Wiring uses `useSyncExternalStore` over the `matchMedia` change event so the
// gate flips reliably when devtools emulates a narrow viewport AFTER initial
// hydration (the prior `resize`-listener version sometimes missed CDP-driven
// viewport changes on preview deploys).
import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

const BREAKPOINT_PX = 768;
const QUERY = `(max-width: ${BREAKPOINT_PX - 1}px)`;

export function isMobileViewport(width: number, userAgent: string): boolean {
  if (width > 0 && width < BREAKPOINT_PX) return true;
  return /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    userAgent,
  );
}

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia(QUERY);
  // Cover both modern + Safari <14 listener shapes.
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", cb);
    window.addEventListener("resize", cb);
    return () => {
      mql.removeEventListener("change", cb);
      window.removeEventListener("resize", cb);
    };
  }
  mql.addListener(cb);
  window.addEventListener("resize", cb);
  return () => {
    mql.removeListener(cb);
    window.removeEventListener("resize", cb);
  };
}

function getSnapshot(): boolean {
  return isMobileViewport(window.innerWidth, navigator.userAgent);
}

function getServerSnapshot(): boolean {
  // Server-rendered HTML must NOT contain the gate (would flash + cause a
  // hydration mismatch on desktop). The client snapshot takes over on the
  // first post-hydration tick.
  return false;
}

export function MobileGate() {
  const pathname = usePathname();
  const isMobile = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // The public marketing landing is fully mobile-responsive; never gate it.
  if (pathname === "/landing") return null;
  if (!isMobile) return null;

  return (
    <div
      data-testid="mobile-gate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-gate-title"
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-3 bg-background p-8 text-center"
    >
      <h1
        id="mobile-gate-title"
        className="font-display text-2xl font-semibold"
      >
        Please open on desktop :)
      </h1>
      <p className="max-w-xs text-sm text-muted-foreground">
        Episteme is built for a larger screen for now. Open this page on a
        desktop or laptop to continue.
      </p>
    </div>
  );
}
