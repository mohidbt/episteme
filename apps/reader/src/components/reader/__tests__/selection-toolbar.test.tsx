import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SelectionToolbar } from "../selection-toolbar";

afterEach(() => cleanup());

const rect = { top: 100, left: 100, width: 50, height: 20 };

describe("SelectionToolbar new actions", () => {
  it("Comment reveals textarea, Save calls onComment with text", () => {
    const onComment = vi.fn();
    render(
      <SelectionToolbar
        rect={rect}
        onHighlight={() => {}}
        onDismiss={() => {}}
        onComment={onComment}
        onAskAi={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /comment/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onComment).toHaveBeenCalledWith("hello");
  });

  it("Ask AI triggers onAskAi", () => {
    const onAskAi = vi.fn();
    render(
      <SelectionToolbar
        rect={rect}
        onHighlight={() => {}}
        onDismiss={() => {}}
        onComment={() => {}}
        onAskAi={onAskAi}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /ask ai/i }));
    expect(onAskAi).toHaveBeenCalled();
  });
});
