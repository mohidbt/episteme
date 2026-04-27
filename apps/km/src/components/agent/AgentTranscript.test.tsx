// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { AgentTranscript } from "./AgentTranscript";
import type { AgentEvent } from "@/lib/agent-events";

function sseEncode(events: AgentEvent[]): Uint8Array {
  const enc = new TextEncoder();
  const body = events
    .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");
  return enc.encode(body);
}

function streamResponse(events: AgentEvent[]): Response {
  const bytes = sseEncode(events);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AgentTranscript", () => {
  it("renders empty state when no cards", () => {
    render(<AgentTranscript threadId="t1" />);
    expect(screen.getByTestId("agent-transcript")).toBeTruthy();
    expect(screen.getByText(/no messages yet/i)).toBeTruthy();
  });

  it("invokes onSendMessage override when provided (no fetch)", () => {
    const sent = vi.fn();
    render(<AgentTranscript threadId="t1" onSendMessage={sent} />);
    const ta = screen.getByLabelText("Message agent") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(sent).toHaveBeenCalledWith("hi");
  });

  it("Enter sends, Shift+Enter does not", () => {
    const sent = vi.fn();
    render(<AgentTranscript threadId="t1" onSendMessage={sent} />);
    const ta = screen.getByLabelText("Message agent") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "x" } });
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });
    expect(sent).not.toHaveBeenCalled();
    fireEvent.change(ta, { target: { value: "y" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(sent).toHaveBeenCalledWith("y");
  });

  it("renders one card per event from SSE stream", async () => {
    const events: AgentEvent[] = [
      { type: "text", id: "r1", delta: "Hello, " },
      { type: "text", id: "r1", delta: "world!" },
      {
        type: "tool_call",
        id: "tc1",
        name: "search",
        args: { q: "x" },
        state: "input-available",
      },
      {
        type: "tool_result",
        id: "tc1",
        output: { ok: true },
        state: "output-available",
      },
      { type: "skill_load", name: "deep-read" },
      { type: "suggestion", items: ["a", "b"] },
      { type: "done", thread_id: "t1" },
    ];
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      streamResponse(events),
    );

    render(<AgentTranscript threadId="t1" />);
    const ta = screen.getByLabelText("Message agent") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "go" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByTestId("card-text").textContent).toContain(
        "Hello, world!",
      );
    });
    expect(screen.getByTestId("card-tool")).toBeTruthy();
    expect(screen.getByTestId("card-skill_load")).toBeTruthy();
    expect(screen.getByTestId("card-suggestion")).toBeTruthy();

    expect(fetch).toHaveBeenCalledWith(
      "/api/agents/km/invoke",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
