"use client";

// GSD-11 — Full-screen mobile gate. Episteme is desktop-only for now; on
// narrow viewports we render a polite "please open on desktop" overlay
// instead of the actual app, so users don't waste time wrestling with a
// layout that isn't tuned for phones.
//
// Detection is intentionally simple: viewport width + a UA mobile hint.
// Either signal flips the gate on. Tablets in landscape (>= 768px) get
// through.
import { useEffect, useState } from "react";

const BREAKPOINT_PX = 768;

export function isMobileViewport(width: number, userAgent: string): boolean {
  if (width > 0 && width < BREAKPOINT_PX) return true;
  return /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    userAgent,
  );
}

export function MobileGate() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function check() {
      setIsMobile(isMobileViewport(window.innerWidth, navigator.userAgent));
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

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
