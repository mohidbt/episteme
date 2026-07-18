// @vitest-environment jsdom
// GSD-11 — mobile-gate viewport detection + render.
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { MobileGate, isMobileViewport } from "./MobileGate";

// GSD-151: MobileGate self-suppresses on the public marketing landing. It keys
// off the `data-landing` attribute that the landing route sets on <html> (the
// same marker used to hide the Sentry widget), NOT off usePathname — the bare
// marketing domain serves the landing via an internal `/` → `/landing` rewrite,
// so the client-visible pathname is `/`, not `/landing`. The attribute is the
// only signal that survives the rewrite. This replaced the old server-side
// x-mk-landing header gate, which forced dynamic rendering of every route.

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    get: () => ua,
  });
}

// Minimal MediaQueryList polyfill — useSyncExternalStore subscribes via
// `matchMedia(...).addEventListener("change", cb)` so jsdom (which lacks
// matchMedia) needs a stub. Listeners are stored on a module-level set so
// tests can drive change events explicitly when needed.
type Listener = (e: MediaQueryListEvent) => void;
const listeners = new Set<Listener>();
function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: window.innerWidth < 768,
      media: query,
      addEventListener: (_t: string, cb: Listener) => listeners.add(cb),
      removeEventListener: (_t: string, cb: Listener) => listeners.delete(cb),
      addListener: (cb: Listener) => listeners.add(cb),
      removeListener: (cb: Listener) => listeners.delete(cb),
      dispatchEvent: () => true,
      onchange: null,
    }),
  });
}

beforeEach(() => {
  listeners.clear();
  installMatchMedia();
  document.documentElement.removeAttribute("data-landing");
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-landing");
});

describe("isMobileViewport", () => {
  it("returns true for narrow viewport regardless of UA", () => {
    expect(isMobileViewport(500, DESKTOP_UA)).toBe(true);
  });

  it("returns false for desktop viewport + desktop UA", () => {
    expect(isMobileViewport(1440, DESKTOP_UA)).toBe(false);
  });

  it("returns true for desktop-width viewport but mobile UA", () => {
    expect(isMobileViewport(1024, IPHONE_UA)).toBe(true);
  });

  it("returns false at the 768px breakpoint", () => {
    expect(isMobileViewport(768, DESKTOP_UA)).toBe(false);
  });
});

describe("MobileGate", () => {
  it("renders the gate overlay on a narrow viewport (initial render)", () => {
    setViewport(400);
    setUserAgent(DESKTOP_UA);
    act(() => {
      render(<MobileGate />);
    });
    const gate = screen.getByTestId("mobile-gate");
    expect(gate).toBeTruthy();
    expect(gate.textContent).toMatch(/desktop/i);
  });

  it("renders nothing on a desktop viewport", () => {
    setViewport(1440);
    setUserAgent(DESKTOP_UA);
    act(() => {
      render(<MobileGate />);
    });
    expect(screen.queryByTestId("mobile-gate")).toBeNull();
  });

  it("renders nothing when the landing marker is present, even on a narrow viewport", () => {
    // The landing route sets data-landing on <html> (survives the marketing
    // host's `/` → `/landing` rewrite, where the client pathname is still `/`).
    document.documentElement.setAttribute("data-landing", "");
    setViewport(400);
    setUserAgent(IPHONE_UA);
    act(() => {
      render(<MobileGate />);
    });
    expect(screen.queryByTestId("mobile-gate")).toBeNull();
  });

  it("hides the gate when the landing marker appears AFTER mount (mobile landing)", async () => {
    setViewport(400);
    setUserAgent(IPHONE_UA);
    act(() => {
      render(<MobileGate />);
    });
    // Gate is visible on a narrow viewport before the landing route mounts.
    expect(screen.getByTestId("mobile-gate")).toBeTruthy();
    // Landing route mounts and stamps the marker → gate must disappear. The
    // MutationObserver callback fires on a microtask, so flush it inside act().
    await act(async () => {
      document.documentElement.setAttribute("data-landing", "");
      await Promise.resolve();
    });
    expect(screen.queryByTestId("mobile-gate")).toBeNull();
  });

  it("flips the gate on when viewport shrinks AFTER mount (matchMedia change)", () => {
    setViewport(1440);
    setUserAgent(DESKTOP_UA);
    act(() => {
      render(<MobileGate />);
    });
    expect(screen.queryByTestId("mobile-gate")).toBeNull();

    // Simulate CDP emulate: viewport shrinks + matchMedia change fires.
    setViewport(390);
    act(() => {
      // useSyncExternalStore re-reads getSnapshot when any subscribed listener
      // fires — invoke them all to mimic the matchMedia "change" event.
      for (const cb of listeners) cb({} as MediaQueryListEvent);
    });
    expect(screen.getByTestId("mobile-gate")).toBeTruthy();
  });
});
