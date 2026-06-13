// @vitest-environment jsdom
// GSD-100 - RED. Assistant message bubble must NOT leak raw
// `[[pdf:UUID#pN]]` tokens. The deep-read skill emits these as
// page-granular citation anchors; the renderer must transform them into
// inline pills (or page links) that route through the same citation
// click handler as InlineCitationPills.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render as rtlRender,
  screen,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import type { ReactElement } from "react";

function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  return rtlRender(<DndContext>{ui}</DndContext>, options);
}

const mockRouterPush = vi.fn();
const mockPathname = vi.fn<() => string>(() => "/");

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: mockRouterPush,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => mockPathname(),
}));

import { AgentTranscript } from "../AgentTranscript";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  mockRouterPush.mockReset();
  mockPathname.mockReset();
  mockPathname.mockReturnValue("/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PAPER_ID = "72e1ca2f-4b4f-44b5-bcc0-fc01b3d088a2";

describe("AgentTranscript - pdf token rendering (GSD-100)", () => {
  it("assistant bubble with embedded pdf token does NOT render the raw `[[pdf:` substring", () => {
    render(
      <AgentTranscript
        threadId="t1"
        initialMessages={[
          {
            id: "a-1",
            role: "assistant",
            text: `Key result [[pdf:${PAPER_ID}#p2]] for the experiment.`,
          },
        ]}
      />,
    );
    const card = screen.getByTestId("card-text");
    expect(card.textContent ?? "").not.toContain("[[pdf:");
  });

  it("renders a pdf pill button for the embedded token with the page number", () => {
    render(
      <AgentTranscript
        threadId="t1"
        initialMessages={[
          {
            id: "a-1",
            role: "assistant",
            text: `Key result [[pdf:${PAPER_ID}#p2]] for the experiment.`,
          },
        ]}
      />,
    );
    const pill = screen.getByTestId("pdf-anchor-pill") as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.textContent ?? "").toMatch(/p\s*2/i);
    expect(pill.getAttribute("data-paper-id")).toBe(PAPER_ID);
    expect(pill.getAttribute("data-page")).toBe("2");
  });

  it("renders all pdf tokens in order, none leak as raw text", () => {
    render(
      <AgentTranscript
        threadId="t1"
        initialMessages={[
          {
            id: "a-1",
            role: "assistant",
            text: `A [[pdf:${PAPER_ID}#p1]] and B [[pdf:${PAPER_ID}#p3]] end.`,
          },
        ]}
      />,
    );
    const pills = screen.getAllByTestId("pdf-anchor-pill");
    expect(pills.length).toBe(2);
    expect(pills[0].getAttribute("data-page")).toBe("1");
    expect(pills[1].getAttribute("data-page")).toBe("3");
    expect(screen.getByTestId("card-text").textContent ?? "").not.toContain(
      "[[pdf:",
    );
  });

  it("clicking the pdf pill outside the reader routes to the paper reader on the right page", () => {
    mockPathname.mockReturnValue("/");
    render(
      <AgentTranscript
        threadId="t1"
        initialMessages={[
          {
            id: "a-1",
            role: "assistant",
            text: `Result [[pdf:${PAPER_ID}#p5]] here.`,
          },
        ]}
      />,
    );
    const pill = screen.getByTestId("pdf-anchor-pill");
    fireEvent.click(pill);
    expect(mockRouterPush).toHaveBeenCalledTimes(1);
    const url = mockRouterPush.mock.calls[0][0] as string;
    expect(url).toContain(`/papers/${PAPER_ID}/read`);
    expect(url).toContain("p=5");
  });

  it("user bubble path is untouched (no transform applied)", () => {
    render(
      <AgentTranscript
        threadId="t1"
        initialMessages={[
          {
            id: "u-1",
            role: "user",
            text: "I am the user, no pdf tokens here",
          },
        ]}
      />,
    );
    const card = screen.getByTestId("card-text");
    expect(card.getAttribute("data-role")).toBe("user");
    expect(card.textContent).toContain("I am the user");
  });

  it("legacy filename form `[[pdf:foo.pdf]]` passes through (reserved for notes resolver)", () => {
    render(
      <AgentTranscript
        threadId="t1"
        initialMessages={[
          {
            id: "a-1",
            role: "assistant",
            text: "see [[pdf:foo.pdf]] later",
          },
        ]}
      />,
    );
    expect(screen.queryByTestId("pdf-anchor-pill")).toBeNull();
  });
});
