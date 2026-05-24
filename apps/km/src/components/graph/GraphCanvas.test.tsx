// @vitest-environment jsdom
// K11 — GraphCanvas dblclick opens paper/reference page
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

describe("GraphCanvas click/dblclick debounce (K11)", () => {
  it("single-click then dblclick on paper within 250ms routes ONLY to /p/<id>", () => {
    vi.useFakeTimers();
    try {
      render(<GraphCanvas payload={payload()} />);
      const click = capturedProps.current?.onNodeClick as ((n: unknown) => void) | undefined;
      const dbl = capturedProps.current?.onNodeDblClick as ((n: unknown) => void) | undefined;
      expect(click).toBeTypeOf("function");
      expect(dbl).toBeTypeOf("function");
      const node = { id: "abc", kind: "paper", label: "Paper A", fgId: "paper:abc" };
      click!(node);
      // dblclick fires shortly after single click — well under the 250ms debounce
      vi.advanceTimersByTime(50);
      dbl!(node);
      // Flush any pending timers
      vi.advanceTimersByTime(500);
      // Only the dblclick navigation should occur — single-click was cancelled
      expect(pushMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith("/p/abc");
      expect(pushMock).not.toHaveBeenCalledWith("/graph/abc");
    } finally {
      vi.useRealTimers();
    }
  });

  it("single-click without dblclick still routes paper to /graph/<id> after debounce", () => {
    vi.useFakeTimers();
    try {
      render(<GraphCanvas payload={payload()} />);
      const click = capturedProps.current?.onNodeClick as ((n: unknown) => void) | undefined;
      click!({ id: "abc", kind: "paper", label: "Paper A", fgId: "paper:abc" });
      vi.advanceTimersByTime(300);
      expect(pushMock).toHaveBeenCalledWith("/graph/abc");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("GraphCanvas dblclick", () => {
  it("dblclick on paper node opens /p/<id>", () => {
    render(<GraphCanvas payload={payload()} />);
    const handler = capturedProps.current?.onNodeDblClick as
      | ((n: unknown) => void)
      | undefined;
    expect(handler).toBeTypeOf("function");
    handler!({ id: "abc", kind: "paper", label: "Paper A", fgId: "paper:abc" });
    expect(pushMock).toHaveBeenCalledWith("/p/abc");
  });

  it("dblclick on reference node opens /r/<id>", () => {
    render(<GraphCanvas payload={payload()} />);
    const handler = capturedProps.current?.onNodeDblClick as
      | ((n: unknown) => void)
      | undefined;
    expect(handler).toBeTypeOf("function");
    handler!({ id: "def", kind: "reference", label: "Ref D", fgId: "reference:def" });
    expect(pushMock).toHaveBeenCalledWith("/r/def");
  });

  it("dblclick on note node does nothing", () => {
    render(<GraphCanvas payload={payload()} />);
    const handler = capturedProps.current?.onNodeDblClick as
      | ((n: unknown) => void)
      | undefined;
    handler!({ id: "ghi", kind: "note", label: "Note G", fgId: "note:ghi" });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
