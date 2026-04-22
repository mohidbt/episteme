// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { SummarizeAction } from "./SummarizeAction";

type FetchImpl = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(impl: FetchImpl) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return impl(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: /summarize/i }));
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SummarizeAction", () => {
  it("opens panel on trigger click", async () => {
    mockFetch(() => streamResponse(["data: [DONE]\n\n"]));
    render(<SummarizeAction noteId="n-1" contentMd="hello" />);
    openPanel();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  });

  it("streams summary text into the panel", async () => {
    mockFetch((url) => {
      if (url === "/api/ai/complete") {
        return streamResponse([
          'data: {"type":"token","content":"Sum"}\n\n',
          'data: {"type":"token","content":"mary"}\n\n',
          'data: {"type":"token","content":" done"}\n\n',
          "data: [DONE]\n\n",
        ]);
      }
      return new Response("not found", { status: 404 });
    });
    render(<SummarizeAction noteId="n-1" contentMd="hello" />);
    openPanel();
    await waitFor(() => {
      expect(
        screen.getByTestId("summary-text").textContent,
      ).toBe("Summary done");
    });
  });

  it("Copy action writes streamed text to clipboard and closes panel", async () => {
    mockFetch((url) => {
      if (url === "/api/ai/complete") {
        return streamResponse([
          'data: {"type":"token","content":"my summary"}\n\n',
          "data: [DONE]\n\n",
        ]);
      }
      return new Response("not found", { status: 404 });
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<SummarizeAction noteId="n-1" contentMd="hello" />);
    openPanel();
    await waitFor(() => {
      expect(screen.getByTestId("summary-text").textContent).toBe("my summary");
    });
    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("my summary");
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("Insert at top: snapshots, flushes, PATCHes with summary prepended", async () => {
    const calls: string[] = [];
    const onBeforeInsert = vi.fn(async () => {
      calls.push("flush");
    });
    mockFetch((url, init) => {
      if (url === "/api/ai/complete") {
        return streamResponse([
          'data: {"type":"token","content":"S1"}\n\n',
          "data: [DONE]\n\n",
        ]);
      }
      if (
        url === "/api/notes/n-1/revisions/snapshot?reason=pre-ai-edit" &&
        init?.method === "POST"
      ) {
        calls.push("snapshot");
        return new Response(null, { status: 201 });
      }
      if (
        url === "/api/notes/n-1" &&
        (!init || init.method === undefined || init.method === "GET")
      ) {
        calls.push("get");
        return new Response(JSON.stringify({ contentMd: "ORIG" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (
        url === "/api/notes/n-1/content?reason=manual" &&
        init?.method === "PATCH"
      ) {
        calls.push("patch");
        const body = JSON.parse(String(init.body)) as { contentMd: string };
        expect(body.contentMd).toBe("S1\n\nORIG");
        return new Response(null, { status: 204 });
      }
      return new Response("not found", { status: 404 });
    });

    render(
      <SummarizeAction
        noteId="n-1"
        contentMd="ORIG"
        onBeforeInsert={onBeforeInsert}
      />,
    );
    openPanel();
    await waitFor(() => {
      expect(screen.getByTestId("summary-text").textContent).toBe("S1");
    });
    fireEvent.click(screen.getByRole("button", { name: /insert at top/i }));

    await waitFor(() => {
      expect(calls).toEqual(["snapshot", "flush", "get", "patch"]);
    });
    expect(onBeforeInsert).toHaveBeenCalledTimes(1);
  });

  it("Insert at bottom: PATCH body has summary appended", async () => {
    let patchBody: string | null = null;
    mockFetch((url, init) => {
      if (url === "/api/ai/complete") {
        return streamResponse([
          'data: {"type":"token","content":"SUM"}\n\n',
          "data: [DONE]\n\n",
        ]);
      }
      if (
        url === "/api/notes/n-1/revisions/snapshot?reason=pre-ai-edit" &&
        init?.method === "POST"
      ) {
        return new Response(null, { status: 201 });
      }
      if (
        url === "/api/notes/n-1" &&
        (!init || init.method === undefined || init.method === "GET")
      ) {
        return new Response(JSON.stringify({ contentMd: "BODY" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (
        url === "/api/notes/n-1/content?reason=manual" &&
        init?.method === "PATCH"
      ) {
        patchBody = String(init.body);
        return new Response(null, { status: 204 });
      }
      return new Response("not found", { status: 404 });
    });

    render(<SummarizeAction noteId="n-1" contentMd="BODY" />);
    openPanel();
    await waitFor(() => {
      expect(screen.getByTestId("summary-text").textContent).toBe("SUM");
    });
    fireEvent.click(screen.getByRole("button", { name: /insert at bottom/i }));

    await waitFor(() => expect(patchBody).not.toBeNull());
    const parsed = JSON.parse(patchBody!) as { contentMd: string };
    expect(parsed.contentMd).toBe("BODY\n\nSUM");
  });

  it("disables Insert buttons while streaming, enables after [DONE]", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const encoder = new TextEncoder();
    mockFetch((url) => {
      if (url === "/api/ai/complete") {
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
            c.enqueue(
              encoder.encode('data: {"type":"token","content":"A"}\n\n'),
            );
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response("not found", { status: 404 });
    });

    render(<SummarizeAction noteId="n-1" contentMd="x" />);
    openPanel();

    await waitFor(() => {
      expect(screen.getByTestId("summary-text").textContent).toBe("A");
    });

    const topBtn = screen.getByRole("button", {
      name: /insert at top/i,
    }) as HTMLButtonElement;
    expect(topBtn.disabled).toBe(true);

    // finish the stream
    controller!.enqueue(encoder.encode("data: [DONE]\n\n"));
    controller!.close();

    await waitFor(() => {
      const btn = screen.getByRole("button", {
        name: /insert at top/i,
      }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });

  it("swallows stream errors: panel shows error state and Insert disabled", async () => {
    mockFetch((url) => {
      if (url === "/api/ai/complete") {
        return streamResponse([
          'data: {"type":"error","message":"upstream boom"}\n\n',
          "data: [DONE]\n\n",
        ]);
      }
      return new Response("not found", { status: 404 });
    });
    render(<SummarizeAction noteId="n-1" contentMd="x" />);
    openPanel();

    await waitFor(() => {
      expect(screen.getByTestId("summarize-error")).toBeTruthy();
    });
    const topBtn = screen.getByRole("button", {
      name: /insert at top/i,
    }) as HTMLButtonElement;
    expect(topBtn.disabled).toBe(true);
  });
});
