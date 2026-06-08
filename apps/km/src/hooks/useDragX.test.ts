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

describe("GSD-34 — pointer-capture leak edge cases", () => {
  function makeTarget() {
    const t = document.createElement("div");
    Object.defineProperty(t, "getBoundingClientRect", {
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
    return t;
  }

  it("pointercancel ends the drag (no follow-cursor after OS interrupt)", () => {
    const { result } = renderHook(() =>
      useDragX({
        storageKey: "k-cancel",
        elementWidth: 40,
        elementHeight: 40,
        axis: "xy",
      }),
    );
    const target = makeTarget();

    act(() => {
      result.current.pointerHandlers.onPointerDown({
        clientX: 110, clientY: 110, pointerId: 1, currentTarget: target, target,
        // biome-ignore lint/suspicious/noExplicitAny: stub
      } as any);
    });
    act(() => {
      result.current.pointerHandlers.onPointerMove({
        clientX: 200, clientY: 200, pointerId: 1, currentTarget: target, target,
        // biome-ignore lint/suspicious/noExplicitAny: stub
      } as any);
    });
    const yMid = result.current.y;
    expect(yMid).not.toBeNull();

    // Browser cancels the gesture (touch interrupted, OS alert, devtools, etc).
    act(() => {
      result.current.pointerHandlers.onPointerCancel?.({
        clientX: 200, clientY: 200, pointerId: 1, currentTarget: target, target,
        // biome-ignore lint/suspicious/noExplicitAny: stub
      } as any);
    });

    // Subsequent pointermove (e.g. user moves cursor without re-pressing)
    // must NOT update position — drag is over.
    act(() => {
      result.current.pointerHandlers.onPointerMove({
        clientX: 500, clientY: 500, pointerId: 1, currentTarget: target, target,
        // biome-ignore lint/suspicious/noExplicitAny: stub
      } as any);
    });
    expect(result.current.y).toBe(yMid);
    expect(result.current.x).toBe(200 - 10); // last known x from the mid-drag
  });

  it("lostpointercapture ends the drag (no follow-cursor after capture loss)", () => {
    const { result } = renderHook(() =>
      useDragX({
        storageKey: "k-lost",
        elementWidth: 40,
        elementHeight: 40,
        axis: "xy",
      }),
    );
    const target = makeTarget();

    act(() => {
      result.current.pointerHandlers.onPointerDown({
        clientX: 110, clientY: 110, pointerId: 1, currentTarget: target, target,
        // biome-ignore lint/suspicious/noExplicitAny: stub
      } as any);
    });
    act(() => {
      result.current.pointerHandlers.onPointerMove({
        clientX: 250, clientY: 180, pointerId: 1, currentTarget: target, target,
        // biome-ignore lint/suspicious/noExplicitAny: stub
      } as any);
    });
    const xMid = result.current.x;

    // Browser fires lostpointercapture (e.g. another node steals capture, or
    // capturing element remounts mid-drag).
    act(() => {
      result.current.pointerHandlers.onLostPointerCapture?.({
        clientX: 250, clientY: 180, pointerId: 1, currentTarget: target, target,
        // biome-ignore lint/suspicious/noExplicitAny: stub
      } as any);
    });

    // Cursor keeps moving — element must NOT follow.
    act(() => {
      result.current.pointerHandlers.onPointerMove({
        clientX: 800, clientY: 600, pointerId: 1, currentTarget: target, target,
        // biome-ignore lint/suspicious/noExplicitAny: stub
      } as any);
    });
    expect(result.current.x).toBe(xMid);
  });

  it("new pointerdown resets stale didMoveRef from a prior leaked gesture", () => {
    const { result } = renderHook(() =>
      useDragX({ storageKey: "k-stale", elementWidth: 40, axis: "x" }),
    );
    const target = makeTarget();

    // Leaked gesture: down + move beyond threshold, no up.
    act(() => {
      result.current.pointerHandlers.onPointerDown({
        clientX: 110, clientY: 110, pointerId: 1, currentTarget: target, target,
        // biome-ignore lint/suspicious/noExplicitAny: stub
      } as any);
    });
    act(() => {
      result.current.pointerHandlers.onPointerMove({
        clientX: 300, clientY: 110, pointerId: 1, currentTarget: target, target,
        // biome-ignore lint/suspicious/noExplicitAny: stub
      } as any);
    });
    // Simulate capture loss.
    act(() => {
      result.current.pointerHandlers.onLostPointerCapture?.({
        pointerId: 1, currentTarget: target, target,
        // biome-ignore lint/suspicious/noExplicitAny: stub
      } as any);
    });

    // New gesture starts — didMoveRef must reset to false so a tap counts as click.
    act(() => {
      result.current.pointerHandlers.onPointerDown({
        clientX: 120, clientY: 120, pointerId: 2, currentTarget: target, target,
        // biome-ignore lint/suspicious/noExplicitAny: stub
      } as any);
    });
    expect(result.current.didMoveRef.current).toBe(false);
  });
});
