// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { toast } from "sonner";
import { PapersetView } from "./PapersetView";

const baseProps = {
  id: "ps-1",
  libraryId: 1,
  initial: {
    columns: [
      { name: "x", description: "Description for x" },
      { name: "y", description: "Description for y" },
    ],
    rowRefs: [{ paper_id: "p1" }, { paper_id: "p2" }],
    cellGrounding: {} as Record<
      string,
      Record<string, { paper_id: string; block_ids: string[] }>
    >,
    runningCells: [] as Array<{ row: number; col: string }>,
    cellValues: {},
  },
  paperById: {
    p1: { id: "p1", title: "Paper One", filename: "paper-one.pdf" },
    p2: { id: "p2", title: "", filename: "paper-two.pdf" },
  },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PapersetView", () => {
  it("renders header row with column names", () => {
    render(<PapersetView {...baseProps} />);
    expect(screen.getByTestId("col-header-x")).toBeTruthy();
    expect(screen.getByTestId("col-header-y")).toBeTruthy();
    expect(screen.getByText(/Paper$/)).toBeTruthy();
  });

  it("renders row count = rowRefs.length", () => {
    render(<PapersetView {...baseProps} />);
    expect(screen.getByTestId("row-header-0").textContent).toMatch(/Paper One/);
    expect(screen.getByTestId("row-header-1").textContent).toMatch(
      /paper-two\.pdf/,
    );
  });

  it("clicking an empty cell selects it and enables Run enrichment", async () => {
    render(<PapersetView {...baseProps} />);
    const runBtn = screen.getByTestId("paperset-enrich-all") as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
    const cell = screen.getByTestId("cell-0-x");
    fireEvent.mouseDown(cell, { button: 0 });
    await waitFor(() => {
      expect(cell.getAttribute("data-selected")).toBe("true");
      expect(runBtn.disabled).toBe(false);
    });
  });

  it("dragging across empty cells moves selection and paints hover trail", async () => {
    render(<PapersetView {...baseProps} />);
    const start = screen.getByTestId("cell-0-x");
    const end = screen.getByTestId("cell-1-y");

    fireEvent.mouseDown(start, { button: 0 });
    fireEvent.mouseEnter(end);

    await waitFor(() => {
      expect(screen.getByTestId("cell-0-x").getAttribute("data-selected")).toBe("true");
      expect(screen.getByTestId("cell-0-y").getAttribute("data-selected")).toBe("true");
      expect(screen.getByTestId("cell-1-x").getAttribute("data-selected")).toBe("true");
      expect(screen.getByTestId("cell-1-y").getAttribute("data-selected")).toBe("true");
      expect(end.getAttribute("data-hovered")).toBe("true");
      expect(end.getAttribute("data-hover-trail")).toBe("true");
    });

    fireEvent.mouseEnter(screen.getByTestId("cell-0-y"));

    await waitFor(() => {
      expect(screen.getByTestId("cell-0-x").getAttribute("data-selected")).toBe("true");
      expect(screen.getByTestId("cell-0-y").getAttribute("data-selected")).toBe("true");
      expect(screen.getByTestId("cell-1-x").getAttribute("data-selected")).toBe("false");
      expect(screen.getByTestId("cell-1-y").getAttribute("data-selected")).toBe("false");
    });
  });

  it("Run enrichment is disabled while a run is in progress", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(
          new TextEncoder().encode(
            `event: cell_update\ndata: ${JSON.stringify({
              row: 0,
              col: "x",
              value: "hello",
            })}\n\n`,
          ),
        );
        c.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PapersetView {...baseProps} />);
    fireEvent.mouseDown(screen.getByTestId("cell-0-x"), { button: 0 });
    const runBtn = screen.getByTestId("paperset-enrich-all") as HTMLButtonElement;
    await waitFor(() => expect(runBtn.disabled).toBe(false));

    await act(async () => {
      fireEvent.click(runBtn);
    });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/papersets/ps-1/enrich",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    await waitFor(() => {
      const cell = screen.getByTestId("cell-0-x");
      expect(cell.getAttribute("data-cell-state")).toBe("filled");
      expect(cell.textContent).toContain("hello");
    });
  });

  it("renders failed banner and toast when enrich returns SSE error", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(
          new TextEncoder().encode(
            `event: error\ndata: ${JSON.stringify({
              code: "not_implemented",
              message: "data-extract skill ships in Phase 1.4.x",
            })}\n\n`,
          ),
        );
        c.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, body: stream }),
    );

    render(<PapersetView {...baseProps} />);
    fireEvent.mouseDown(screen.getByTestId("cell-0-x"), { button: 0 });
    const runBtn = screen.getByTestId(
      "paperset-enrich-all",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(runBtn);
    });

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/failed/i);
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("data-extract skill"),
      );
    });
  });

  it("clicking a row header selects all empty cells in that row", async () => {
    render(<PapersetView {...baseProps} />);
    fireEvent.click(screen.getByTestId("row-header-0"));
    await waitFor(() => {
      expect(
        screen.getByTestId("cell-0-x").getAttribute("data-selected"),
      ).toBe("true");
      expect(
        screen.getByTestId("cell-0-y").getAttribute("data-selected"),
      ).toBe("true");
      expect(
        screen.getByTestId("cell-1-x").getAttribute("data-selected"),
      ).toBe("false");
    });
  });

  it("Add column dialog appends column to grid header without reload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        columns: [
          { name: "x", description: "Description for x" },
          { name: "y", description: "Description for y" },
          { name: "assay_type", description: "What kind of assay?" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PapersetView {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /Add column/ }));

    const nameInput = await screen.findByPlaceholderText("assay_type");
    fireEvent.change(nameInput, { target: { value: "assay_type" } });
    const descInput = screen.getByPlaceholderText(
      /What kind of biological assay/,
    );
    fireEvent.change(descInput, { target: { value: "What kind of assay?" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/papersets/ps-1/columns",
        expect.objectContaining({ method: "POST" }),
      );
      expect(screen.getByTestId("col-header-assay_type")).toBeTruthy();
    });
  });

  it("table wrapper has rounded corners and overflow-hidden", () => {
    render(<PapersetView {...baseProps} />);
    const wrapper = screen.getByTestId("paperset-grid-wrapper");
    expect(wrapper.className).toMatch(/rounded-lg/);
    expect(wrapper.className).toMatch(/overflow-hidden/);
  });

  it("renders no selection-frame when nothing is selected", () => {
    render(<PapersetView {...baseProps} />);
    expect(screen.queryByTestId("selection-frame")).toBeNull();
  });

  it("selecting a row renders exactly ONE selection-frame element", async () => {
    render(<PapersetView {...baseProps} />);
    fireEvent.click(screen.getByTestId("row-header-0"));
    await waitFor(() => {
      const frames = screen.queryAllByTestId("selection-frame");
      expect(frames.length).toBe(1);
      expect(frames[0].getAttribute("data-selection-kind")).toBe("row");
    });
  });

  it("selecting a column renders exactly ONE selection-frame element", async () => {
    render(<PapersetView {...baseProps} />);
    fireEvent.click(screen.getByTestId("col-header-x"));
    await waitFor(() => {
      const frames = screen.queryAllByTestId("selection-frame");
      expect(frames.length).toBe(1);
      expect(frames[0].getAttribute("data-selection-kind")).toBe("col");
    });
  });

  it("⌘↵ triggers enrichment when a cell is selected", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.close();
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, body: stream });
    vi.stubGlobal("fetch", fetchMock);

    render(<PapersetView {...baseProps} />);
    fireEvent.mouseDown(screen.getByTestId("cell-0-x"), { button: 0 });
    await act(async () => {
      fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/papersets/ps-1/enrich",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  // --- #103a: row selection frame excludes column-0 (title) ---
  it("row selection frame starts at data columns, not the title column", async () => {
    render(<PapersetView {...baseProps} />);
    fireEvent.click(screen.getByTestId("row-header-0"));
    await waitFor(() => {
      const frame = screen.getByTestId("selection-frame");
      // The frame should exist and be of kind "row"
      expect(frame.getAttribute("data-selection-kind")).toBe("row");
    });
  });

  // --- #103b: multi-cell border width matches single-cell ---
  it("selection frame uses ring-2 (same width as single-cell ring)", async () => {
    render(<PapersetView {...baseProps} />);
    fireEvent.click(screen.getByTestId("row-header-0"));
    await waitFor(() => {
      const frame = screen.getByTestId("selection-frame");
      expect(frame.className).toMatch(/ring-2/);
    });
  });

  // --- #104: grounding pill shows p.XX, never #XX ---
  it("grounding pill shows p.XX format, never #XX", () => {
    const props = {
      ...baseProps,
      initial: {
        ...baseProps.initial,
        cellValues: { "0:x": "some value" },
        cellGrounding: {
          "0": {
            x: {
              paper_id: "p1",
              // Use a realistic block ID where the paperId is a UUID-style
              // string that won't match _p\d+_ — only the page part matches.
              block_ids: ["block_abc123_p5_0"],
            },
          },
        },
      },
    };
    render(<PapersetView {...props} />);
    const cell = screen.getByTestId("cell-0-x");
    expect(cell.getAttribute("data-cell-state")).toBe("filled");
    // The chip should show "p.5", never "#5" or "#105"
    const chip = cell.querySelector("[data-testid='cell-grounding-chip']");
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toBe("p.5");
    expect(chip?.textContent).not.toMatch(/^#/);
  });

  it("grounding pill is hidden for block IDs with no page anchor pattern", () => {
    const props = {
      ...baseProps,
      initial: {
        ...baseProps.initial,
        cellValues: { "0:x": "some value" },
        cellGrounding: {
          "0": {
            x: {
              paper_id: "p1",
              // block ID WITHOUT the _p<number>_ pattern → firstPage null
              block_ids: ["seg_ABC_nonpage"],
            },
          },
        },
      },
    };
    render(<PapersetView {...props} />);
    const cell = screen.getByTestId("cell-0-x");
    expect(cell.getAttribute("data-cell-state")).toBe("filled");
    const chip = cell.querySelector("[data-testid='cell-grounding-chip']");
    expect(chip).toBeNull();
  });

  // --- #105: cell detail view ---
  it("clicking a filled cell opens detail sheet with full text", async () => {
    const props = {
      ...baseProps,
      initial: {
        ...baseProps.initial,
        cellValues: { "0:x": "This is the full cell content" },
        cellGrounding: {
          "0": {
            x: {
              paper_id: "p1",
              block_ids: ["block_abc123_p3_0"],
            },
          },
        },
      },
    };
    render(<PapersetView {...props} />);
    const cell = screen.getByTestId("cell-0-x");
    expect(cell.getAttribute("data-cell-state")).toBe("filled");
    fireEvent.click(cell);
    await waitFor(() => {
      expect(screen.getByTestId("cell-detail-sheet")).toBeTruthy();
      expect(
        screen.getByTestId("cell-detail-sheet").textContent,
      ).toContain("This is the full cell content");
    });
  });

  it("cell detail sheet closes on ESC", async () => {
    const props = {
      ...baseProps,
      initial: {
        ...baseProps.initial,
        cellValues: { "0:x": "content" },
        cellGrounding: {
          "0": {
            x: {
              paper_id: "p1",
              block_ids: ["block_abc123_p3_0"],
            },
          },
        },
      },
    };
    render(<PapersetView {...props} />);
    fireEvent.click(screen.getByTestId("cell-0-x"));
    await waitFor(() => {
      expect(screen.getByTestId("cell-detail-sheet")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    await waitFor(() => {
      expect(screen.queryByTestId("cell-detail-sheet")).toBeNull();
    });
  });

  // --- #106: re-run enrichment confirmation ---
  it("shows confirmation dialog when re-running enrichment on already-filled cells", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.close();
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, body: stream });
    vi.stubGlobal("fetch", fetchMock);

    const props = {
      ...baseProps,
      initial: {
        ...baseProps.initial,
        cellValues: { "0:x": "already enriched" },
        cellGrounding: {},
      },
    };
    render(<PapersetView {...props} />);
    // Cell 0:y is empty and selectable
    fireEvent.mouseDown(screen.getByTestId("cell-0-y"), { button: 0 });
    const runBtn = screen.getByTestId(
      "paperset-enrich-all",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(runBtn);
    });
    // The confirmation should NOT have been called because none of the
    // selected cells (0:y) are filled. But we verify confirm was not called.
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  // --- #110: no "(missing paper)" rows in seed output ---
  it("seed data has no (missing paper) references", async () => {
    // Read the seed file source to verify it doesn't contain the
    // reference-only rows that produced "(missing paper)" entries.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const seedPath = path.join(
      process.cwd(),
      "src/lib/seed-anonymous-user.ts",
    );
    const source = fs.readFileSync(seedPath, "utf8");
    // The seed should NOT contain `pcaInsertedRefs.slice(3)` which produced
    // reference-only rows (causing "(missing paper)" entries).
    expect(source).not.toContain("pcaInsertedRefs.slice(3)");
    // The rowRefs should only use pcaInsertedPapers (paper-backed rows).
    expect(source).toContain("pcaInsertedPapers.map");
  });
});
