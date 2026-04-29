// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    cellGrounding: {},
    runningCells: [],
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
    const runBtn = screen.getByTestId("run-enrichment-btn") as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
    const cell = screen.getByTestId("cell-0-x");
    fireEvent.mouseDown(cell, { button: 0 });
    await waitFor(() => {
      expect(cell.getAttribute("data-selected")).toBe("true");
      expect(runBtn.disabled).toBe(false);
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
    const runBtn = screen.getByTestId("run-enrichment-btn") as HTMLButtonElement;
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
      "run-enrichment-btn",
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
});
