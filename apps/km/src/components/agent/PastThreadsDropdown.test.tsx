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

  it("renders a disabled empty-state when the paper has no past threads", async () => {
    vi.stubGlobal("fetch", fetchOk({ threads: [] }));
    const { container } = render(
      <PastThreadsDropdown paperId={PAPER} onSelect={() => {}} />,
    );
    await waitFor(() => {
      expect(
        container.querySelector("[data-testid=past-threads-dropdown]"),
      ).not.toBeNull();
    });
    expect(screen.getByText(/no past chats on this paper/i)).toBeTruthy();
  });

  it("renders the thread title when present, falling back to timestamp otherwise (N8)", async () => {
    vi.stubGlobal(
      "fetch",
      fetchOk({
        threads: [
          { thread_id: "t2", created_at: "2026-01-03T12:00:00.000Z", title: "Explain page 4" },
          { thread_id: "t1", created_at: "2026-01-02T12:00:00.000Z", title: null },
          { thread_id: "t0", created_at: "2026-01-01T12:00:00.000Z", title: "   " },
        ],
      }),
    );
    render(<PastThreadsDropdown paperId={PAPER} onSelect={() => {}} />);
    const select = (await screen.findByRole("combobox")) as HTMLSelectElement;
    const opts = Array.from(select.querySelectorAll("option")).filter(
      (o) => o.value !== "",
    );
    // t2 → title, t1 → timestamp fallback (null), t0 → timestamp fallback (whitespace-only)
    expect(opts[0].textContent).toContain("Explain page 4");
    expect(opts[1].textContent).toMatch(/\d/);
    expect(opts[1].textContent).not.toContain("null");
    expect(opts[2].textContent).toMatch(/\d/);
  });

  it("truncates titles longer than 80 chars with an ellipsis (N8 UI defense)", async () => {
    const long = "a".repeat(200);
    vi.stubGlobal(
      "fetch",
      fetchOk({
        threads: [
          { thread_id: "t-long", created_at: "2026-05-01T00:00:00Z", title: long },
        ],
      }),
    );
    render(<PastThreadsDropdown paperId={PAPER} onSelect={() => {}} />);
    const select = (await screen.findByRole("combobox")) as HTMLSelectElement;
    const opts = Array.from(select.querySelectorAll("option")).filter(
      (o) => o.value !== "",
    );
    const text = opts[0].textContent ?? "";
    // 80 chars + "…" = 81; allow " (current)" suffix etc. but cap title body.
    expect(text.length).toBeLessThanOrEqual(83);
    expect(text).toContain("…");
  });

  it("strips control chars and line breaks from titles (N8 UI defense)", async () => {
    vi.stubGlobal(
      "fetch",
      fetchOk({
        threads: [
          {
            thread_id: "t-nl",
            created_at: "2026-05-01T00:00:00Z",
            title: "first line\nsecond\tline\x07bell",
          },
        ],
      }),
    );
    render(<PastThreadsDropdown paperId={PAPER} onSelect={() => {}} />);
    const select = (await screen.findByRole("combobox")) as HTMLSelectElement;
    const opts = Array.from(select.querySelectorAll("option")).filter(
      (o) => o.value !== "",
    );
    const text = opts[0].textContent ?? "";
    expect(text).not.toContain("\n");
    expect(text).not.toContain("\t");
    expect(text).not.toContain("\x07");
    expect(text).toContain("first line second line bell");
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

  it("refetches threads when refreshKey changes (parent signals post-stamp)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ threads: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            threads: [
              { thread_id: "t-new", created_at: "2026-05-24T00:00:00Z" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <PastThreadsDropdown
        paperId={PAPER}
        onSelect={() => {}}
        activeThreadId="t-new"
        refreshKey={0}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // Same activeThreadId — only refreshKey bump should re-fetch.
    rerender(
      <PastThreadsDropdown
        paperId={PAPER}
        onSelect={() => {}}
        activeThreadId="t-new"
        refreshKey={1}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("does NOT flash empty-state while refetching — resets to null during fetch", async () => {
    // 1st fetch: populated. 2nd fetch: hangs until we resolve it.
    type ResolveFn = (v: Response) => void;
    const resolver: { fn: ResolveFn | null } = { fn: null };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            threads: [
              { thread_id: "t-a", created_at: "2026-05-01T00:00:00Z" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((res) => {
            resolver.fn = res;
          }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { rerender, container } = render(
      <PastThreadsDropdown
        paperId={PAPER}
        onSelect={() => {}}
        activeThreadId="t-a"
        refreshKey={0}
      />,
    );

    // First load completes.
    await waitFor(() => {
      expect(
        container.querySelector("[data-testid=past-threads-dropdown]"),
      ).not.toBeNull();
    });

    // Bump refreshKey — should immediately hide the dropdown (threads === null)
    // rather than keep showing the stale state until the next response arrives.
    rerender(
      <PastThreadsDropdown
        paperId={PAPER}
        onSelect={() => {}}
        activeThreadId="t-a"
        refreshKey={1}
      />,
    );

    // While the 2nd fetch is in-flight, the component must render nothing
    // (threads === null) so it never flashes the empty-state placeholder.
    await waitFor(() => {
      expect(
        container.querySelector("[data-testid=past-threads-dropdown]"),
      ).toBeNull();
    });
    expect(screen.queryByText(/no past chats on this paper/i)).toBeNull();

    // Now finish the fetch — dropdown reappears with the new payload.
    resolver.fn?.(
      new Response(
        JSON.stringify({
          threads: [
            { thread_id: "t-a", created_at: "2026-05-01T00:00:00Z" },
            { thread_id: "t-b", created_at: "2026-05-24T00:00:00Z" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await waitFor(() => {
      expect(screen.getByText(/Past threads \(2\)/i)).toBeTruthy();
    });
  });
});
