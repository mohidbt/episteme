// @vitest-environment jsdom
// GSD-11 — mobile-gate viewport detection + render.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { MobileGate, isMobileViewport } from "./MobileGate";

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

afterEach(() => cleanup());

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
  it("renders the gate overlay on a narrow viewport", () => {
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
});
