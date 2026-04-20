import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { createRef } from "react";
import { ChatPanel } from "../chat-panel";

afterEach(() => cleanup());

function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(enc.encode(c));
      ctrl.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("ChatPanel /highlight slash command", () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const baseProps = () => {
    const ref = createRef<HTMLDivElement>();
    return {
      documentId: 42,
      open: true,
      scrollContainerRef: ref as unknown as React.RefObject<HTMLElement | null>,
      currentPage: 1,
      processingStatus: "ready" as const,
    };
  };

  it("shows hint message when /highlight has no instruction (no fetch)", async () => {
    render(<ChatPanel {...baseProps()} />);
    const input = screen.getByPlaceholderText(/ask about this paper/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/highlight" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByText(/Try:/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes /highlight ... to auto-highlight endpoint, shows progress, finalizes on done", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"type":"run","runId":"abc","conversationId":5}\n\n',
        'data: {"type":"progress","step":"semantic_search","detail":"searching: loss"}\n\n',
        'data: {"type":"done","summary":"Highlighted 2 passages.","highlightsCount":2}\n\n',
        "data: [DONE]\n\n",
      ])
    );
    const onHighlightsChanged = vi.fn();

    render(<ChatPanel {...baseProps()} onHighlightsChanged={onHighlightsChanged} />);
    const input = screen.getByPlaceholderText(/ask about this paper/i) as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: "/highlight the loss function" } });
      fireEvent.submit(input.closest("form")!);
    });

    await waitFor(() => {
      expect(onHighlightsChanged).toHaveBeenCalled();
    });

    // Hit the right endpoint with the extracted instruction.
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/documents/42/auto-highlight",
      expect.objectContaining({ method: "POST" })
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({ instruction: "the loss function" });

    // Progress bullet appears, then gets replaced by final summary.
    expect(await screen.findByText(/Highlighted 2 passages/)).toBeTruthy();
    // The user message still shows the raw slash command.
    expect(screen.getByText("/highlight the loss function")).toBeTruthy();
  });

  it("shows error when stream emits error event", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"type":"run","runId":"abc","conversationId":5}\n\n',
        'data: {"type":"error","message":"agent exploded"}\n\n',
        "data: [DONE]\n\n",
      ])
    );
    render(<ChatPanel {...baseProps()} />);
    const input = screen.getByPlaceholderText(/ask about this paper/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "/highlight foo" } });
      fireEvent.submit(input.closest("form")!);
    });
    await waitFor(() => {
      expect(screen.getByText(/Error: agent exploded/)).toBeTruthy();
    });
  });
});
