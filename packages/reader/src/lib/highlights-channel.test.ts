import { afterEach, describe, it, expect, vi } from "vitest";
import {
  postHighlightsChange,
  subscribeHighlightsChange,
} from "./highlights-channel";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("postHighlightsChange — same-tab delivery", () => {
  it("delivers events to in-process subscribers in the same tab (regression: BroadcastChannel does NOT)", () => {
    const cb = vi.fn();
    const unsub = subscribeHighlightsChange(cb);
    try {
      postHighlightsChange({ paperId: "p-1", source: "ai" });
      // The whole point: BroadcastChannel intentionally skips the
      // sender's own context, so without local fan-out a chat-agent
      // posting an "ai" event would never reach a usePaperHighlights
      // hook mounted in the same tab — exactly the production bug
      // observed on tryepisteme.com.
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith({ paperId: "p-1", source: "ai" });
    } finally {
      unsub();
    }
  });

  it("supports multiple local subscribers", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unA = subscribeHighlightsChange(a);
    const unB = subscribeHighlightsChange(b);
    try {
      postHighlightsChange({ paperId: "p-2", source: "user" });
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    } finally {
      unA();
      unB();
    }
  });

  it("unsubscribes cleanly: callback no longer fires after unsubscribe", () => {
    const cb = vi.fn();
    const unsub = subscribeHighlightsChange(cb);
    unsub();
    postHighlightsChange({ paperId: "p-3", source: "ai" });
    expect(cb).not.toHaveBeenCalled();
  });

  it("isolates subscriber failures so one throwing callback doesn't block others", () => {
    const boom = vi.fn(() => { throw new Error("boom"); });
    const ok = vi.fn();
    const unA = subscribeHighlightsChange(boom);
    const unB = subscribeHighlightsChange(ok);
    try {
      postHighlightsChange({ paperId: "p-4", source: "ai" });
      expect(boom).toHaveBeenCalledTimes(1);
      expect(ok).toHaveBeenCalledTimes(1);
    } finally {
      unA();
      unB();
    }
  });

  it("supports subscribers added during dispatch without infinite loops", () => {
    const late = vi.fn();
    const early = vi.fn(() => {
      subscribeHighlightsChange(late);
    });
    const unA = subscribeHighlightsChange(early);
    try {
      postHighlightsChange({ paperId: "p-5", source: "ai" });
      // The late subscriber registered mid-dispatch must NOT fire for
      // the same event (we snapshot subscribers before invoking).
      expect(early).toHaveBeenCalledTimes(1);
      expect(late).not.toHaveBeenCalled();
      // Next post hits both.
      postHighlightsChange({ paperId: "p-5", source: "ai" });
      expect(early).toHaveBeenCalledTimes(2);
      expect(late).toHaveBeenCalledTimes(1);
    } finally {
      unA();
    }
  });
});
