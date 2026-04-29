// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";

import { PaperPickerDialog } from "./PaperPickerDialog";

type FetchImpl = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(impl: FetchImpl) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return impl(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const TWO_PAPERS = [
  { id: "p1", title: "Alpha", filename: "a.pdf" },
  { id: "p2", title: "Beta", filename: "b.pdf" },
];

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PaperPickerDialog", () => {
  it("renders papers and confirms with selected ids", async () => {
    mockFetch(() => new Response(JSON.stringify(TWO_PAPERS), { status: 200 }));
    const onConfirm = vi.fn();
    render(
      <PaperPickerDialog
        open
        onOpenChange={() => {}}
        onConfirm={onConfirm}
        excludeIds={[]}
      />,
    );
    await screen.findByText("Alpha");
    fireEvent.click(screen.getByText("Alpha"));
    fireEvent.click(screen.getByText("Beta"));
    fireEvent.click(screen.getByRole("button", { name: /^add/i }));
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith(["p1", "p2"]),
    );
  });

  it("filters by search input", async () => {
    mockFetch(() => new Response(JSON.stringify(TWO_PAPERS), { status: 200 }));
    render(
      <PaperPickerDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        excludeIds={[]}
      />,
    );
    await screen.findByText("Alpha");
    fireEvent.change(screen.getByLabelText(/search papers/i), {
      target: { value: "bet" },
    });
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("hides papers in excludeIds", async () => {
    mockFetch(() => new Response(JSON.stringify(TWO_PAPERS), { status: 200 }));
    render(
      <PaperPickerDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        excludeIds={["p1"]}
      />,
    );
    await screen.findByText("Beta");
    expect(screen.queryByText("Alpha")).toBeNull();
  });

  it("Add button disabled when zero selected", async () => {
    mockFetch(() => new Response(JSON.stringify(TWO_PAPERS), { status: 200 }));
    render(
      <PaperPickerDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        excludeIds={[]}
      />,
    );
    await screen.findByText("Alpha");
    const addBtn = screen.getByRole("button", {
      name: /^add$/i,
    }) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
    fireEvent.click(screen.getByText("Alpha"));
    const addBtn2 = screen.getByRole("button", {
      name: /^add \(1\)$/i,
    }) as HTMLButtonElement;
    expect(addBtn2.disabled).toBe(false);
  });

  it("displays empty state when no papers", async () => {
    mockFetch(() => new Response(JSON.stringify([]), { status: 200 }));
    render(
      <PaperPickerDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        excludeIds={[]}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/no papers yet/i)).toBeTruthy(),
    );
  });
});
