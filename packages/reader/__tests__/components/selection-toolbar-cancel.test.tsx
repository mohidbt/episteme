/**
 * B16 — SelectionToolbar Cancel must fire onDismiss so the parent can clear
 * both the toolbar selection snapshot and the window text selection. Previous
 * suspicion (Cancel not wired) verified here as a regression guard.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SelectionToolbar } from "../../src/components/SelectionToolbar";

afterEach(() => cleanup());

const RECT = { top: 100, left: 100, width: 50, height: 12 };

describe("SelectionToolbar — Cancel", () => {
  it("calls onDismiss when Cancel is clicked in main mode", () => {
    const onDismiss = vi.fn();
    const { getByText } = render(
      <SelectionToolbar
        rect={RECT}
        onHighlight={() => {}}
        onDismiss={onDismiss}
        onComment={() => {}}
      />,
    );
    fireEvent.click(getByText("Cancel"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss when Cancel is clicked in comment mode", () => {
    const onDismiss = vi.fn();
    const { getByText, getByPlaceholderText } = render(
      <SelectionToolbar
        rect={RECT}
        onHighlight={() => {}}
        onDismiss={onDismiss}
        onComment={() => {}}
      />,
    );
    fireEvent.click(getByText("Comment"));
    // We're now in comment mode — the textarea must exist.
    expect(getByPlaceholderText("Add a comment…")).toBeTruthy();
    fireEvent.click(getByText("Cancel"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
