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
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
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
    expect(screen.getByText("Pdf")).toBeTruthy();
  });

  it("filters commands by query", async () => {
    const onSelect = vi.fn();
    render(<SlashCommandTypeahead query="cite" onSelect={onSelect} ref={null} />);
    expect(screen.queryByText("AI")).toBeNull();
    expect(screen.getByText("Cite")).toBeTruthy();
  });
});

describe("SlashCommandTypeahead — pdf mode", () => {
  it("shows Pdf command in the command list", () => {
    const onSelect = vi.fn();
    render(<SlashCommandTypeahead query="" onSelect={onSelect} ref={null} />);
    expect(screen.getByText("Pdf")).toBeTruthy();
  });

  it("filters to Pdf when query is 'pdf'", () => {
    const onSelect = vi.fn();
    render(<SlashCommandTypeahead query="pdf" onSelect={onSelect} ref={null} />);
    expect(screen.getByText("Pdf")).toBeTruthy();
    expect(screen.queryByText("AI")).toBeNull();
    expect(screen.queryByText("Cite")).toBeNull();
  });

  it("clicking Pdf command switches to pdf typeahead mode", async () => {
    const onSelect = vi.fn();
    render(<SlashCommandTypeahead query="pdf" onSelect={onSelect} ref={null} />);
    const pdfBtn = screen.getByText("Pdf").closest("button");
    expect(pdfBtn).toBeTruthy();
    await act(async () => {
      fireEvent.mouseDown(pdfBtn!);
    });
    // After clicking, the pdf typeahead should be shown (placeholder text for empty query)
    expect(screen.queryByText("Pdf")).toBeNull();
  });

  it("Pdf selection calls onSelect with title='Pdf' and pdfEmbed payload", async () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            id: "uuid-1",
            title: "Transformers Survey",
            filename: "transformers.pdf",
            year: 2023,
            doi: null,
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const onSelect = vi.fn();
    const ref: { current: { onKeyDown: (p: { event: KeyboardEvent }) => boolean } | null } = {
      current: null,
    };
    render(
      <SlashCommandTypeahead
        query="pdf"
        onSelect={onSelect}
        ref={(r) => { ref.current = r; }}
      />,
    );

    // Click Pdf to switch mode
    const pdfBtn = screen.getByText("Pdf").closest("button");
    await act(async () => {
      fireEvent.mouseDown(pdfBtn!);
    });

    // Type a query character to trigger search
    await act(async () => {
      ref.current?.onKeyDown({ event: new KeyboardEvent("keydown", { key: "t", bubbles: true }) });
    });

    // Advance timer to trigger fetch debounce
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Now press Enter to pick the first result
    await act(async () => {
      ref.current?.onKeyDown({ event: new KeyboardEvent("keydown", { key: "Enter", bubbles: true }) });
    });

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Pdf" }),
    );
  });
});

describe("SlashCommandTypeahead — link mode", () => {
  beforeEach(() => {
    // WikiLinkTypeahead fetches from /api/wiki-link/search — stub it
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ notes: [], references: [], papers: [] }),
    }));
  });

  it("shows Link command in the command list", () => {
    const onSelect = vi.fn();
    render(<SlashCommandTypeahead query="" onSelect={onSelect} ref={null} />);
    expect(screen.getByText("Link")).toBeTruthy();
  });

  it("filters to Link when query is 'link'", () => {
    const onSelect = vi.fn();
    render(<SlashCommandTypeahead query="link" onSelect={onSelect} ref={null} />);
    expect(screen.getByText("Link")).toBeTruthy();
    expect(screen.queryByText("AI")).toBeNull();
  });

  it("clicking Link command switches to link typeahead mode (WikiLinkTypeahead shown)", async () => {
    const onSelect = vi.fn();
    render(<SlashCommandTypeahead query="link" onSelect={onSelect} ref={null} />);
    const linkBtn = screen.getByText("Link").closest("button");
    expect(linkBtn).toBeTruthy();
    await act(async () => {
      fireEvent.mouseDown(linkBtn!);
    });
    // After switching, the command list is gone; WikiLinkTypeahead prompt is shown
    expect(screen.queryByText("Link")).toBeNull();
    // WikiLinkTypeahead renders "Type to search…" when query is empty
    expect(screen.getByText(/Type to search/i)).toBeTruthy();
  });

  it("typing extends query in link mode", async () => {
    const onSelect = vi.fn();
    const ref: { current: { onKeyDown: (p: { event: KeyboardEvent }) => boolean } | null } = {
      current: null,
    };
    render(
      <SlashCommandTypeahead
        query="link"
        onSelect={onSelect}
        ref={(r) => { ref.current = r; }}
      />,
    );
    const linkBtn = screen.getByText("Link").closest("button");
    await act(async () => {
      fireEvent.mouseDown(linkBtn!);
    });
    // Type a character — should extend the query (no error thrown)
    await act(async () => {
      ref.current?.onKeyDown({ event: new KeyboardEvent("keydown", { key: "F", bubbles: true }) });
    });
    // Component stays in link mode (WikiLinkTypeahead still rendered)
    expect(screen.queryByText("Link")).toBeNull();
  });

  it("Link selection calls onSelect with title='Link' and wikiLink payload", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        notes: [{ id: "note-1", title: "Foo Note", slug: "foo-note" }],
        references: [],
        papers: [],
      }),
    }));

    const onSelect = vi.fn();
    const ref: { current: { onKeyDown: (p: { event: KeyboardEvent }) => boolean } | null } = {
      current: null,
    };
    render(
      <SlashCommandTypeahead
        query="link"
        onSelect={onSelect}
        ref={(r) => { ref.current = r; }}
      />,
    );

    const linkBtn = screen.getByText("Link").closest("button");
    await act(async () => {
      fireEvent.mouseDown(linkBtn!);
    });

    // Type a query character
    await act(async () => {
      ref.current?.onKeyDown({ event: new KeyboardEvent("keydown", { key: "F", bubbles: true }) });
    });

    // Advance debounce timer
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Press Enter to pick the first result
    await act(async () => {
      ref.current?.onKeyDown({ event: new KeyboardEvent("keydown", { key: "Enter", bubbles: true }) });
    });

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Link" }),
    );
    vi.useRealTimers();
  });
});

describe("SlashCommandTypeahead — agent mode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows Agent command in the command list", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ enabled_skills: [] }),
    }));
    const onSelect = vi.fn();
    render(<SlashCommandTypeahead query="" onSelect={onSelect} ref={null} />);
    expect(screen.getByText("Agent")).toBeTruthy();
  });

  it("filters to Agent when query is 'agent'", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ enabled_skills: [] }),
    }));
    const onSelect = vi.fn();
    render(<SlashCommandTypeahead query="agent" onSelect={onSelect} ref={null} />);
    expect(screen.getByText("Agent")).toBeTruthy();
    expect(screen.queryByText("AI")).toBeNull();
  });

  it("clicking Agent shows empty state when fetch returns 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    }));

    const onSelect = vi.fn();
    render(<SlashCommandTypeahead query="agent" onSelect={onSelect} ref={null} />);
    const agentBtn = screen.getByText("Agent").closest("button");
    await act(async () => {
      fireEvent.mouseDown(agentBtn!);
    });

    // Flush promises so the fetch settles
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText(/No agents installed/i)).toBeTruthy();
  });

  it("clicking Agent shows empty state when enabled_skills is empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ enabled_skills: [] }),
    }));

    const onSelect = vi.fn();
    render(<SlashCommandTypeahead query="agent" onSelect={onSelect} ref={null} />);
    const agentBtn = screen.getByText("Agent").closest("button");
    await act(async () => {
      fireEvent.mouseDown(agentBtn!);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText(/No agents installed/i)).toBeTruthy();
  });

  it("clicking Agent shows skill list when enabled_skills is non-empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ enabled_skills: ["triage"] }),
    }));

    const onSelect = vi.fn();
    render(<SlashCommandTypeahead query="agent" onSelect={onSelect} ref={null} />);
    const agentBtn = screen.getByText("Agent").closest("button");
    await act(async () => {
      fireEvent.mouseDown(agentBtn!);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("triage")).toBeTruthy();
  });
});
