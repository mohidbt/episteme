import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { createRef } from "react";
import { ChatPanel } from "../chat-panel";
import type { ChatSeed } from "../chat-panel";

afterEach(() => cleanup());

function baseProps() {
  const ref = createRef<HTMLDivElement>();
  return {
    documentId: 1,
    open: true,
    scrollContainerRef: ref as unknown as React.RefObject<HTMLElement | null>,
    currentPage: 3,
    processingStatus: "ready" as const,
  };
}

describe("ChatPanel scope=segment seed", () => {
  it("pre-fills input with the prefix part of the seed text", () => {
    const seed: ChatSeed = {
      text: "Explain this figure.\n\nCaption: Figure 1: A chart.",
      pageNumber: 3,
      scope: "segment",
      nonce: 1,
    };
    render(<ChatPanel {...baseProps()} seed={seed} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("Explain this figure.");
  });

  it("renders a context chip with the payload part", () => {
    const seed: ChatSeed = {
      text: "Explain this figure.\n\nCaption: Figure 1: A chart.",
      pageNumber: 3,
      scope: "segment",
      nonce: 1,
    };
    render(<ChatPanel {...baseProps()} seed={seed} />);
    expect(screen.getByText("Caption: Figure 1: A chart.")).toBeTruthy();
    expect(screen.getByText("Context")).toBeTruthy();
  });

  it("renders a context chip for a formula payload", () => {
    const seed: ChatSeed = {
      text: "Explain this formula.\n\n$$E = mc^2$$",
      pageNumber: 2,
      scope: "segment",
      nonce: 2,
    };
    render(<ChatPanel {...baseProps()} seed={seed} />);
    expect(screen.getByText("$$E = mc^2$$")).toBeTruthy();
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("Explain this formula.");
  });

  it("shows no context chip when seed has no payload (no double-newline)", () => {
    const seed: ChatSeed = {
      text: "Explain this paragraph.",
      pageNumber: 1,
      scope: "segment",
      nonce: 3,
    };
    render(<ChatPanel {...baseProps()} seed={seed} />);
    // chip is only rendered when payload is non-empty
    expect(screen.queryByText("Context")).toBeNull();
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("Explain this paragraph.");
  });
});
