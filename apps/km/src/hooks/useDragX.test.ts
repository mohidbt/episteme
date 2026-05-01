// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDragX } from "./useDragX";

beforeEach(() => {
  window.localStorage.clear();
  // 1024x768 viewport
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1024,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 768,
  });
});

afterEach(() => {
  window.localStorage.clear();
});

describe("useDragX horizontal-only (legacy behavior)", () => {
  it("restores x from localStorage on mount", () => {
    window.localStorage.setItem("k-x", "200");
    const { result } = renderHook(() =>
      useDragX({ storageKey: "k-x", elementWidth: 56 }),
    );
    expect(result.current.x).toBe(200);
  });
});

describe("useDragX #83 — xy axis with snap-to-bottom", () => {
  it("when axis='xy', persists x but snaps y to bottom on release", () => {
    const { result } = renderHook(() =>
      useDragX({
        storageKey: "k-xy",
        elementWidth: 40,
        elementHeight: 40,
        axis: "xy",
        snapY: "bottom",
      }),
    );

    // simulate a drag: pointerdown at (100,100), move to (300, 200), up
    const target = document.createElement("div");
    Object.defineProperty(target, "getBoundingClientRect", {
      value: () => ({
        left: 100,
        top: 100,
        right: 140,
        bottom: 140,
        width: 40,
        height: 40,
        x: 100,
        y: 100,
      }),
    });

    act(() => {
      result.current.pointerHandlers.onPointerDown({
        clientX: 110,
        clientY: 110,
        pointerId: 1,
        currentTarget: target,
        target,
        // biome-ignore lint/suspicious/noExplicitAny: synthetic event stub
      } as any);
    });
    act(() => {
      result.current.pointerHandlers.onPointerMove({
        clientX: 310,
        clientY: 210,
        pointerId: 1,
        currentTarget: target,
        target,
        // biome-ignore lint/suspicious/noExplicitAny: synthetic event stub
      } as any);
    });

    // mid-drag: y tracks the pointer (not yet snapped)
    expect(result.current.y).not.toBeNull();
    expect(result.current.y).not.toBe(window.innerHeight - 40);

    act(() => {
      result.current.pointerHandlers.onPointerUp({
        clientX: 310,
        clientY: 210,
        pointerId: 1,
        currentTarget: target,
        target,
        // biome-ignore lint/suspicious/noExplicitAny: synthetic event stub
      } as any);
    });

    // After release: y snapped to viewport bottom - elementHeight
    expect(result.current.y).toBe(window.innerHeight - 40);
    // x persisted to localStorage
    expect(window.localStorage.getItem("k-xy")).not.toBeNull();
  });
});
