// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PastThreadsDropdown } from "./PastThreadsDropdown";

const PAPER = "00000000-0000-0000-0000-000000000001";

function fetchOk(payload: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PastThreadsDropdown", () => {
  it("renders a dropdown labelled with the thread count", async () => {
    vi.stubGlobal(
      "fetch",
      fetchOk({
        threads: [
          { thread_id: "t2", created_at: "2026-01-03T12:00:00.000Z" },
          { thread_id: "t1", created_at: "2026-01-02T12:00:00.000Z" },
        ],
      }),
    );

    render(<PastThreadsDropdown paperId={PAPER} onSelect={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/Past threads \(2\)/i)).toBeTruthy();
    });
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    // two thread options + the disabled placeholder
    expect(select.querySelectorAll("option")).toHaveLength(3);
  });

  it("hides itself when the paper has no past threads", async () => {
    vi.stubGlobal("fetch", fetchOk({ threads: [] }));
    const { container } = render(
      <PastThreadsDropdown paperId={PAPER} onSelect={() => {}} />,
    );
    // Briefly wait for the fetch microtask to flush.
    await waitFor(() => {
      expect(container.querySelector("[data-testid=past-threads-dropdown]")).toBeNull();
    });
  });

  it("invokes onSelect with the picked thread id", async () => {
    vi.stubGlobal(
      "fetch",
      fetchOk({
        threads: [
          { thread_id: "t2", created_at: "2026-01-03T12:00:00.000Z" },
          { thread_id: "t1", created_at: "2026-01-02T12:00:00.000Z" },
        ],
      }),
    );
    const onSelect = vi.fn();
    render(<PastThreadsDropdown paperId={PAPER} onSelect={onSelect} />);
    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: "t1" } });
    expect(onSelect).toHaveBeenCalledWith("t1");
  });
});
