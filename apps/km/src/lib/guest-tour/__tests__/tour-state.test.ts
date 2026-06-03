// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  getTourDone,
  setTourDone,
  resetTourDoneForTest,
} from "../tour-state";

const STORAGE_KEY = "km:guest_tour_done";

beforeEach(() => {
  resetTourDoneForTest();
});

describe("tour-state", () => {
  it("returns false when storage unset", () => {
    expect(getTourDone()).toBe(false);
  });

  it("returns true after setTourDone()", () => {
    setTourDone();
    expect(getTourDone()).toBe(true);
  });

  it("persists under namespaced storage key", () => {
    setTourDone();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("true");
  });

  it("returns false on malformed JSON in storage", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(getTourDone()).toBe(false);
  });

  it("returns false when window is undefined (SSR-safe)", async () => {
    const origDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    // @ts-expect-error - simulate SSR
    delete globalThis.window;
    try {
      expect(getTourDone()).toBe(false);
    } finally {
      if (origDescriptor) Object.defineProperty(globalThis, "window", origDescriptor);
    }
  });

  it("resetTourDoneForTest clears the flag", () => {
    setTourDone();
    resetTourDoneForTest();
    expect(getTourDone()).toBe(false);
  });

  it("memoryDone short-circuits when localStorage.setItem throws", () => {
    const origSetItem = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      expect(() => setTourDone()).not.toThrow();
      expect(getTourDone()).toBe(true);
      // restore for the read-side check
      window.localStorage.setItem = origSetItem;
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe(null);
    } finally {
      window.localStorage.setItem = origSetItem;
    }
  });

  it("resetTourDoneForTest clears both localStorage and memoryDone", () => {
    // Phase 1: working LS — set + reset clears via LS path.
    setTourDone();
    expect(getTourDone()).toBe(true);
    resetTourDoneForTest();
    expect(getTourDone()).toBe(false);

    // Phase 2: prove memoryDone (not just LS) was cleared. Break setItem so
    // only the memory fallback could be holding the flag, then reset, then
    // confirm getTourDone returns false even with broken LS.
    const origSetItem = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      setTourDone(); // memoryDone = true, LS write fails
      expect(getTourDone()).toBe(true);
      resetTourDoneForTest();
      expect(getTourDone()).toBe(false);
    } finally {
      window.localStorage.setItem = origSetItem;
    }
  });
});
