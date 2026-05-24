// @vitest-environment jsdom
// K11 — GraphCanvas dblclick opens paper/reference page.
// react-force-graph-2d@1.29.1 has no onNodeDblClick prop, so dblclick is
// implemented inside onNodeClick using a timestamp + last-clicked-node ref.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

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
      { id: "ghi", kind: "note", label: "Note G" },
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

  it("two clicks within 300ms on same paper node routes to /p/<id>, NOT /graph/<id>", () => {
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
      vi.advanceTimersByTime(100);
      click!(node);
      // Flush any pending single-click debounce timer
      vi.advanceTimersByTime(500);
      expect(pushMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith("/p/abc");
      expect(pushMock).not.toHaveBeenCalledWith("/graph/abc");
    } finally {
      vi.useRealTimers();
    }
  });

  it("two clicks within 300ms on same reference node routes to /r/<id>", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(0));
      render(<GraphCanvas payload={payload()} />);
      const click = capturedProps.current?.onNodeClick as
        | ((n: unknown) => void)
        | undefined;
      const node = { id: "def", kind: "reference", label: "Ref D", fgId: "reference:def" };
      click!(node);
      vi.advanceTimersByTime(100);
      click!(node);
      vi.advanceTimersByTime(500);
      expect(pushMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith("/r/def");
    } finally {
      vi.useRealTimers();
    }
  });

  it("two clicks >300ms apart on paper: second click navigates to /graph/<id> (treated as fresh single-click)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(0));
      render(<GraphCanvas payload={payload()} />);
      const click = capturedProps.current?.onNodeClick as
        | ((n: unknown) => void)
        | undefined;
      const node = { id: "abc", kind: "paper", label: "Paper A", fgId: "paper:abc" };
      click!(node);
      // Let first click's debounce fire and exceed the 300ms dblclick window
      vi.advanceTimersByTime(310);
      expect(pushMock).toHaveBeenLastCalledWith("/graph/abc");
      // Second click >300ms after first
      click!(node);
      vi.advanceTimersByTime(260);
      // Both clicks resolve to /graph/abc (single-click routing)
      expect(pushMock).toHaveBeenCalledTimes(2);
      expect(pushMock).toHaveBeenNthCalledWith(2, "/graph/abc");
    } finally {
      vi.useRealTimers();
    }
  });

  it("two clicks within 300ms on DIFFERENT nodes: second click starts fresh single-click debounce", () => {
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
      vi.advanceTimersByTime(100);
      click!(nodeB);
      // First click's pending debounce should have been cancelled (different node).
      // Second click starts a fresh debounce; advance past it.
      vi.advanceTimersByTime(260);
      expect(pushMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith("/graph/xyz");
    } finally {
      vi.useRealTimers();
    }
  });

  it("single-click without dblclick still routes paper to /graph/<id> after debounce", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(0));
      render(<GraphCanvas payload={payload()} />);
      const click = capturedProps.current?.onNodeClick as
        | ((n: unknown) => void)
        | undefined;
      click!({ id: "abc", kind: "paper", label: "Paper A", fgId: "paper:abc" });
      vi.advanceTimersByTime(300);
      expect(pushMock).toHaveBeenCalledWith("/graph/abc");
    } finally {
      vi.useRealTimers();
    }
  });

  it("two clicks within 300ms on note node does nothing (no route)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(0));
      render(<GraphCanvas payload={payload()} />);
      const click = capturedProps.current?.onNodeClick as
        | ((n: unknown) => void)
        | undefined;
      const node = { id: "ghi", kind: "note", label: "Note G", fgId: "note:ghi" };
      click!(node);
      vi.advanceTimersByTime(100);
      click!(node);
      vi.advanceTimersByTime(500);
      expect(pushMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
