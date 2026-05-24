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
