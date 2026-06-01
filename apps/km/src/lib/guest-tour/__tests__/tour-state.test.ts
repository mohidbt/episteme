// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  getTourDone,
  setTourDone,
  resetTourDoneForTest,
} from "../tour-state";

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

  it("returns false on malformed JSON in storage", () => {
    window.localStorage.setItem("guest_tour_done", "{not json");
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
});
