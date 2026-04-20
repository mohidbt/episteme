import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChatMessage } from "../chat-message";

afterEach(() => cleanup());

describe("ChatMessage — Review highlights button", () => {
  it("renders button for auto-highlight-result with runId + highlightsCount > 0", () => {
    const onReview = vi.fn();
    render(
      <ChatMessage
        role="assistant"
        content="Highlighted 3 passages."
        kind="auto-highlight-result"
        runId="run-abc"
        highlightsCount={3}
        onReviewHighlights={onReview}
      />
    );
    expect(screen.getByRole("button", { name: /review highlights/i })).toBeTruthy();
  });

  it("does not render button when highlightsCount is 0", () => {
    render(
      <ChatMessage
        role="assistant"
        content="No matches found."
        kind="auto-highlight-result"
        runId="run-abc"
        highlightsCount={0}
        onReviewHighlights={() => {}}
      />
    );
    expect(screen.queryByRole("button", { name: /review highlights/i })).toBeNull();
  });

  it("does not render button when runId missing", () => {
    render(
      <ChatMessage
        role="assistant"
        content="Error."
        kind="auto-highlight-result"
        highlightsCount={2}
        onReviewHighlights={() => {}}
      />
    );
    expect(screen.queryByRole("button", { name: /review highlights/i })).toBeNull();
  });

  it("renders button for regular chat assistant reply (kind undefined) with runId + count > 0", () => {
    render(
      <ChatMessage
        role="assistant"
        content="Here's what I found."
        runId="abc"
        highlightsCount={3}
        onReviewHighlights={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: /review highlights/i })).toBeTruthy();
  });

  it("does not render button for regular chat assistant reply when highlightsCount is 0", () => {
    render(
      <ChatMessage
        role="assistant"
        content="Here's what I found."
        runId="abc"
        highlightsCount={0}
        onReviewHighlights={() => {}}
      />
    );
    expect(screen.queryByRole("button", { name: /review highlights/i })).toBeNull();
  });

  it("calls onReviewHighlights with runId on click", () => {
    const onReview = vi.fn();
    render(
      <ChatMessage
        role="assistant"
        content="Highlighted 2 passages."
        kind="auto-highlight-result"
        runId="run-xyz"
        highlightsCount={2}
        onReviewHighlights={onReview}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /review highlights/i }));
    expect(onReview).toHaveBeenCalledWith("run-xyz");
  });
});
