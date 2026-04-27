// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { useDoubleTapSpace } from "./useDoubleTapSpace";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
});

function tap(target: Element | Document = document) {
  fireEvent.keyDown(target, { key: " ", code: "Space" });
}

describe("useDoubleTapSpace", () => {
  it("does not fire on a single tap", () => {
    const cb = vi.fn();
    renderHook(() => useDoubleTapSpace(cb));
    tap();
    expect(cb).not.toHaveBeenCalled();
  });

  it("fires when two taps occur within 350ms", () => {
    const cb = vi.fn();
    renderHook(() => useDoubleTapSpace(cb));
    tap();
    vi.advanceTimersByTime(100);
    tap();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not fire when taps are >350ms apart", () => {
    const cb = vi.fn();
    renderHook(() => useDoubleTapSpace(cb));
    tap();
    vi.advanceTimersByTime(500);
    tap();
    expect(cb).not.toHaveBeenCalled();
  });

  it("does not fire when an input is focused", () => {
    const cb = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    renderHook(() => useDoubleTapSpace(cb));

    fireEvent.keyDown(input, { key: " ", code: "Space" });
    vi.advanceTimersByTime(50);
    fireEvent.keyDown(input, { key: " ", code: "Space" });

    expect(cb).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("does not fire when a textarea is focused", () => {
    const cb = vi.fn();
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    renderHook(() => useDoubleTapSpace(cb));

    fireEvent.keyDown(ta, { key: " ", code: "Space" });
    vi.advanceTimersByTime(50);
    fireEvent.keyDown(ta, { key: " ", code: "Space" });

    expect(cb).not.toHaveBeenCalled();
    document.body.removeChild(ta);
  });
});
