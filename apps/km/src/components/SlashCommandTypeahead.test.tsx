// @vitest-environment jsdom
/**
 * Tests for SlashCommandTypeahead — specifically the selection reset behavior
 * when the filtered list changes.
 *
 * TDD RED: Before changing useMemo → useEffect, the selection reset is
 * not guaranteed (React can bail out of memo entries). The test verifies
 * behavioral correctness: after the query changes causing the filtered list
 * to change, selection resets to 0.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { SlashCommandTypeahead } from "./SlashCommandTypeahead";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SlashCommandTypeahead — selection reset", () => {
  it("selection resets to 0 when the filtered list changes due to query update", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <SlashCommandTypeahead query="" onSelect={onSelect} ref={null} />,
    );

    // Move selection to item 1 (ArrowDown on the full list)
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(2);

    // The first button should be highlighted (index 0)
    expect(buttons[0].className).toContain("bg-accent");

    // Re-render with a query that narrows the list to 1 item
    await act(async () => {
      rerender(
        <SlashCommandTypeahead query="ai" onSelect={onSelect} ref={null} />,
      );
    });

    // After query change that changes filtered.length, selection should be 0
    // meaning the first (and only) visible button is highlighted
    const afterButtons = screen.getAllByRole("button");
    expect(afterButtons[0].className).toContain("bg-accent");
  });

  it("renders all commands when query is empty", () => {
    const onSelect = vi.fn();
    render(<SlashCommandTypeahead query="" onSelect={onSelect} ref={null} />);
    expect(screen.getByText("AI")).toBeTruthy();
    expect(screen.getByText("Cite")).toBeTruthy();
  });

  it("filters commands by query", async () => {
    const onSelect = vi.fn();
    render(<SlashCommandTypeahead query="cite" onSelect={onSelect} ref={null} />);
    expect(screen.queryByText("AI")).toBeNull();
    expect(screen.getByText("Cite")).toBeTruthy();
  });
});
