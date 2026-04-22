// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { VersionDrawer } from "./VersionDrawer";

type Rev = { id: string; createdAt: string; reason: string; charCount: number };

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      return impl(url, init);
    },
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const rev1: Rev = {
  id: "r-1",
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  reason: "autosave",
  charCount: 100,
};
const rev2: Rev = {
  id: "r-2",
  createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  reason: "manual",
  charCount: 80,
};

describe("VersionDrawer", () => {
  it("opens on trigger click", async () => {
    mockFetch(() =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<VersionDrawer noteId="n-1" currentMd="abc" />);
    fireEvent.click(screen.getByRole("button", { name: /versions/i }));
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toBeTruthy(),
    );
  });

  it("fetches /api/notes/:id/revisions on open", async () => {
    const fetchMock = mockFetch(() =>
      new Response(JSON.stringify([rev1, rev2]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<VersionDrawer noteId="n-1" currentMd="abc" />);
    fireEvent.click(screen.getByRole("button", { name: /versions/i }));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls).toContain("/api/notes/n-1/revisions");
    });
  });

  it("renders revision list with relative time and reason badge", async () => {
    mockFetch(() =>
      new Response(JSON.stringify([rev1, rev2]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<VersionDrawer noteId="n-1" currentMd="abc" />);
    fireEvent.click(screen.getByRole("button", { name: /versions/i }));
    await waitFor(() => {
      expect(screen.getAllByRole("listitem").length).toBe(2);
    });
    expect(screen.getByText(/autosave/i)).toBeTruthy();
    expect(screen.getByText(/manual/i)).toBeTruthy();
    // formatDistanceToNow adds "ago"
    expect(
      screen.getAllByText(/ago/i).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("clicking a revision fetches its body and renders a DiffView", async () => {
    const fetchMock = mockFetch((url) => {
      if (url === "/api/notes/n-1/revisions") {
        return new Response(JSON.stringify([rev1]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "/api/notes/n-1/revisions/r-1") {
        return new Response(
          JSON.stringify({ contentMd: "old body content" }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response("not found", { status: 404 });
    });
    render(
      <VersionDrawer noteId="n-1" currentMd="new body content" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /versions/i }));
    await waitFor(() =>
      expect(screen.getAllByRole("listitem").length).toBe(1),
    );
    fireEvent.click(screen.getByRole("listitem"));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls).toContain("/api/notes/n-1/revisions/r-1");
    });
    await waitFor(() => {
      expect(
        document.body.querySelector("[data-diff='added']") ||
          document.body.querySelector("[data-diff='removed']"),
      ).toBeTruthy();
    });
  });

  it("Save version button POSTs and refreshes list", async () => {
    let listCallCount = 0;
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/notes/n-1/revisions" && (!init || init.method === undefined || init.method === "GET")) {
        listCallCount++;
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "/api/notes/n-1/revisions" && init?.method === "POST") {
        return new Response(
          JSON.stringify({ id: "r-new", createdAt: new Date().toISOString(), reason: "manual" }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });
    render(<VersionDrawer noteId="n-1" currentMd="abc" />);
    fireEvent.click(screen.getByRole("button", { name: /versions/i }));
    await waitFor(() => expect(listCallCount).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: /save version/i }));
    await waitFor(() => {
      const postCalls = fetchMock.mock.calls.filter(
        (c) => String(c[0]) === "/api/notes/n-1/revisions" && c[1] && (c[1] as RequestInit).method === "POST",
      );
      expect(postCalls.length).toBe(1);
    });
    await waitFor(() => expect(listCallCount).toBe(2));
  });

  it("awaits onBeforeRestore before firing the restore POST", async () => {
    const order: string[] = [];
    let resolveBefore!: () => void;
    const beforePromise = new Promise<void>((r) => {
      resolveBefore = r;
    });
    const onBeforeRestore = vi.fn(async () => {
      order.push("before:start");
      await beforePromise;
      order.push("before:end");
    });

    mockFetch((url, init) => {
      if (
        url === "/api/notes/n-1/revisions" &&
        (!init || init.method === undefined || init.method === "GET")
      ) {
        return new Response(JSON.stringify([rev1]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (
        url === "/api/notes/n-1/revisions/r-1" &&
        (!init || init.method === undefined || init.method === "GET")
      ) {
        return new Response(JSON.stringify({ contentMd: "old body" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (
        url === "/api/notes/n-1/revisions/r-1/restore" &&
        init?.method === "POST"
      ) {
        order.push("restore:fetch");
        return new Response(null, { status: 204 });
      }
      return new Response("not found", { status: 404 });
    });

    render(
      <VersionDrawer
        noteId="n-1"
        currentMd="new body"
        onBeforeRestore={onBeforeRestore}
        onAfterRestore={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /versions/i }));
    await waitFor(() =>
      expect(screen.getAllByRole("listitem").length).toBe(1),
    );
    fireEvent.click(screen.getByRole("listitem"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^restore$/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^restore$/i }));
    const confirmButton = await waitFor(() => {
      const dialogs = screen.getAllByRole("dialog");
      for (const d of dialogs) {
        const btn = within(d).queryByRole("button", {
          name: /confirm restore|restore version/i,
        });
        if (btn) return btn;
      }
      throw new Error("confirm button not found");
    });
    fireEvent.click(confirmButton);

    // onBeforeRestore should be in flight; restore fetch must NOT have happened yet.
    await waitFor(() => expect(onBeforeRestore).toHaveBeenCalledTimes(1));
    expect(order).toEqual(["before:start"]);

    resolveBefore();
    await waitFor(() => {
      expect(order).toEqual(["before:start", "before:end", "restore:fetch"]);
    });
  });

  it("Restore button opens confirm dialog; on confirm POSTs restore and calls onAfterRestore", async () => {
    const onAfterRestore = vi.fn();
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/notes/n-1/revisions" && (!init || init.method === undefined || init.method === "GET")) {
        return new Response(JSON.stringify([rev1]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "/api/notes/n-1/revisions/r-1" && (!init || init.method === undefined || init.method === "GET")) {
        return new Response(JSON.stringify({ contentMd: "old body" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "/api/notes/n-1/revisions/r-1/restore" && init?.method === "POST") {
        return new Response(null, { status: 204 });
      }
      return new Response("not found", { status: 404 });
    });
    render(
      <VersionDrawer
        noteId="n-1"
        currentMd="new body"
        onAfterRestore={onAfterRestore}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /versions/i }));
    await waitFor(() =>
      expect(screen.getAllByRole("listitem").length).toBe(1),
    );
    fireEvent.click(screen.getByRole("listitem"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^restore$/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^restore$/i }));
    // Confirm dialog
    const confirmButton = await waitFor(() => {
      const dialogs = screen.getAllByRole("dialog");
      for (const d of dialogs) {
        const btn = within(d).queryByRole("button", { name: /confirm restore|restore version/i });
        if (btn) return btn;
      }
      throw new Error("confirm button not found");
    });
    fireEvent.click(confirmButton);
    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        (c) =>
          String(c[0]) === "/api/notes/n-1/revisions/r-1/restore" &&
          (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(posts.length).toBe(1);
    });
    await waitFor(() => expect(onAfterRestore).toHaveBeenCalledTimes(1));
  });
});
