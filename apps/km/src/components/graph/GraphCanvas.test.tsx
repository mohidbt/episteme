// @vitest-environment jsdom
// K11 — GraphCanvas dblclick opens paper/reference page.
// react-force-graph-2d@1.29.1 has no onNodeDblClick prop, so dblclick is
// implemented inside onNodeClick using a timestamp + last-clicked-node ref.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Mirror the component constants so the test stays in lockstep with the
// production OS-accessibility-aligned threshold (~500ms) without hard-coding
// a number that drifts when the component changes.
const DBLCLICK_WINDOW_MS = 500;
const CLICK_DEBOUNCE_MS = DBLCLICK_WINDOW_MS;

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// Capture props passed into ForceGraph2D so we can invoke its handlers.
const capturedProps: { current: Record<string, unknown> | null } = {
  current: null,
};
vi.mock("react-force-graph-2d", () => ({
  default: (props: Record<string, unknown>) => {
    capturedProps.current = props;
    return null;
  },
}));

import GraphCanvas from "./GraphCanvas.client";
import type { GraphPayload } from "@/lib/graph/types";

beforeEach(() => {
  pushMock.mockReset();
  capturedProps.current = null;
});

function payload(): GraphPayload {
  return {
    nodes: [
      { id: "abc", kind: "paper", label: "Paper A" },
      { id: "def", kind: "reference", label: "Ref D" },
      { id: "ghi", kind: "note", label: "Note G", slug: "note-g" },
    ],
    edges: [],
  };
}

describe("GraphCanvas dblclick via timestamp (K11)", () => {
  it("does NOT wire the dead onNodeDblClick prop", () => {
    render(<GraphCanvas payload={payload()} />);
    // The library has no onNodeDblClick — wiring it is a silent dead end.
    expect(capturedProps.current?.onNodeDblClick).toBeUndefined();
  });

  it("two clicks within the dblclick window on same paper node routes to /p/<id>, NOT /graph/<id>", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(0));
      render(<GraphCanvas payload={payload()} />);
      const click = capturedProps.current?.onNodeClick as
        | ((n: unknown) => void)
        | undefined;
      expect(click).toBeTypeOf("function");
      const node = { id: "abc", kind: "paper", label: "Paper A", fgId: "paper:abc" };
      click!(node);
      // Second click well within the dblclick window.
      vi.advanceTimersByTime(DBLCLICK_WINDOW_MS - 100);
      click!(node);
      // Flush any pending single-click debounce timer
      vi.advanceTimersByTime(CLICK_DEBOUNCE_MS + 100);
      expect(pushMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith("/p/abc");
      expect(pushMock).not.toHaveBeenCalledWith("/graph/abc");
    } finally {
      vi.useRealTimers();
    }
  });

  it("two clicks within the dblclick window on same reference node routes to /r/<id>", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(0));
      render(<GraphCanvas payload={payload()} />);
      const click = capturedProps.current?.onNodeClick as
        | ((n: unknown) => void)
        | undefined;
      const node = { id: "def", kind: "reference", label: "Ref D", fgId: "reference:def" };
      click!(node);
      vi.advanceTimersByTime(DBLCLICK_WINDOW_MS - 100);
      click!(node);
      vi.advanceTimersByTime(CLICK_DEBOUNCE_MS + 100);
      expect(pushMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith("/r/def");
    } finally {
      vi.useRealTimers();
    }
  });

  it("two clicks past the dblclick window on paper: second click navigates to /p/<id> (treated as fresh single-click)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(0));
      render(<GraphCanvas payload={payload()} />);
      const click = capturedProps.current?.onNodeClick as
        | ((n: unknown) => void)
        | undefined;
      const node = { id: "abc", kind: "paper", label: "Paper A", fgId: "paper:abc" };
      click!(node);
      // Let first click's debounce fire and exceed the dblclick window.
      vi.advanceTimersByTime(CLICK_DEBOUNCE_MS + 10);
      expect(pushMock).toHaveBeenLastCalledWith("/p/abc");
      // Second click past the dblclick window relative to the first.
      click!(node);
      vi.advanceTimersByTime(CLICK_DEBOUNCE_MS + 10);
      // Both clicks resolve to /p/abc (single-click routing)
      expect(pushMock).toHaveBeenCalledTimes(2);
      expect(pushMock).toHaveBeenNthCalledWith(2, "/p/abc");
    } finally {
      vi.useRealTimers();
    }
  });

  it("two clicks within the dblclick window on DIFFERENT nodes: second click starts fresh single-click debounce", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(0));
      render(<GraphCanvas payload={payload()} />);
      const click = capturedProps.current?.onNodeClick as
        | ((n: unknown) => void)
        | undefined;
      const nodeA = { id: "abc", kind: "paper", label: "Paper A", fgId: "paper:abc" };
      const nodeB = { id: "xyz", kind: "paper", label: "Paper B", fgId: "paper:xyz" };
      click!(nodeA);
      vi.advanceTimersByTime(DBLCLICK_WINDOW_MS - 100);
      click!(nodeB);
      // First click's pending debounce should have been cancelled (different node).
      // Second click starts a fresh debounce; advance past it.
      vi.advanceTimersByTime(CLICK_DEBOUNCE_MS + 10);
      expect(pushMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith("/p/xyz");
    } finally {
      vi.useRealTimers();
    }
  });

  it("single-click without dblclick routes paper to /p/<id> after debounce (no more /graph subview)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(0));
      render(<GraphCanvas payload={payload()} />);
      const click = capturedProps.current?.onNodeClick as
        | ((n: unknown) => void)
        | undefined;
      click!({ id: "abc", kind: "paper", label: "Paper A", fgId: "paper:abc" });
      vi.advanceTimersByTime(CLICK_DEBOUNCE_MS + 10);
      expect(pushMock).toHaveBeenCalledWith("/p/abc");
      expect(pushMock).not.toHaveBeenCalledWith("/graph/abc");
    } finally {
      vi.useRealTimers();
    }
  });

  it("single-click on reference node routes to /r/<id> after debounce", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(0));
      render(<GraphCanvas payload={payload()} />);
      const click = capturedProps.current?.onNodeClick as
        | ((n: unknown) => void)
        | undefined;
      click!({ id: "def", kind: "reference", label: "Ref D", fgId: "reference:def" });
      vi.advanceTimersByTime(CLICK_DEBOUNCE_MS + 10);
      expect(pushMock).toHaveBeenCalledWith("/r/def");
    } finally {
      vi.useRealTimers();
    }
  });

  it("single-click on note node with slug routes to /n/<slug> after debounce", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(0));
      render(<GraphCanvas payload={payload()} />);
      const click = capturedProps.current?.onNodeClick as
        | ((n: unknown) => void)
        | undefined;
      click!({ id: "ghi", kind: "note", label: "Note G", slug: "note-g", fgId: "note:ghi" });
      vi.advanceTimersByTime(CLICK_DEBOUNCE_MS + 10);
      expect(pushMock).toHaveBeenCalledWith("/n/note-g");
    } finally {
      vi.useRealTimers();
    }
  });

  it("single-click on note node WITHOUT slug does nothing (legacy data guard)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(0));
      const noSlugPayload: GraphPayload = {
        nodes: [{ id: "ghi", kind: "note", label: "Note G" }],
        edges: [],
      };
      render(<GraphCanvas payload={noSlugPayload} />);
      const click = capturedProps.current?.onNodeClick as
        | ((n: unknown) => void)
        | undefined;
      click!({ id: "ghi", kind: "note", label: "Note G", fgId: "note:ghi" });
      vi.advanceTimersByTime(CLICK_DEBOUNCE_MS + 100);
      expect(pushMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("two clicks within the dblclick window on note: cancelled debounce + dblclick routes to /n/<slug>", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(0));
      render(<GraphCanvas payload={payload()} />);
      const click = capturedProps.current?.onNodeClick as
        | ((n: unknown) => void)
        | undefined;
      const node = { id: "ghi", kind: "note", label: "Note G", slug: "note-g", fgId: "note:ghi" };
      click!(node);
      vi.advanceTimersByTime(DBLCLICK_WINDOW_MS - 100);
      click!(node);
      vi.advanceTimersByTime(CLICK_DEBOUNCE_MS + 100);
      // Single push: dblclick cancels the pending debounce and routes immediately.
      expect(pushMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith("/n/note-g");
    } finally {
      vi.useRealTimers();
    }
  });
});
