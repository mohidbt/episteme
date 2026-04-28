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
import deepReadFixture from "../../../e2e/fixtures/agent-stream-deep-read.json";

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
      const assistant = screen
        .getAllByTestId("card-text")
        .find((el) => el.getAttribute("data-role") === "assistant");
      expect(assistant?.textContent).toContain("Hello, world!");
    });
    expect(screen.getByTestId("card-tool")).toBeTruthy();
    expect(screen.getByTestId("card-skill_load")).toBeTruthy();
    expect(screen.getByTestId("card-suggestion")).toBeTruthy();

    expect(fetch).toHaveBeenCalledWith(
      "/api/agents/km/invoke",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("renders all expected card types from deep-read fixture stream", async () => {
    const events = deepReadFixture as unknown as AgentEvent[];
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      streamResponse(events),
    );

    render(<AgentTranscript threadId="t-deep-read" />);
    const ta = screen.getByLabelText("Message agent") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "go" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByTestId("card-skill_load")).toBeTruthy();
    });
    expect(screen.getByTestId("card-thinking")).toBeTruthy();
    expect(screen.getByTestId("card-tool")).toBeTruthy();
    expect(screen.getAllByTestId("card-text").length).toBeGreaterThan(0);
    expect(screen.getByTestId("card-file_diff")).toBeTruthy();
    expect(screen.getByTestId("card-suggestion")).toBeTruthy();
    expect(screen.getByTestId("todo-count").textContent).toContain("2 todos");
    expect(screen.getByTestId("all-citations")).toBeTruthy();
  });

  it("Approve on interrupt POSTs /api/agents/km/resume with correct body", async () => {
    const events: AgentEvent[] = [
      {
        type: "interrupt",
        id: "tc-int-1",
        tool: "make_public",
        args: { note_id: "n1" },
        allowed_decisions: ["approve", "reject"],
      },
    ];
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(streamResponse(events)) // /invoke
      .mockResolvedValueOnce(
        new Response("", { status: 200, headers: { "content-type": "text/event-stream" } }),
      ); // /resume

    render(<AgentTranscript threadId="t-int" />);
    const ta = screen.getByLabelText("Message agent") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "go" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    const approveBtn = await waitFor(() =>
      screen.getByRole("button", { name: /approve/i }),
    );
    fireEvent.click(approveBtn);

    await waitFor(() => {
      const calls = fetchMock.mock.calls;
      const resumeCall = calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("/api/agents/km/resume"),
      );
      expect(resumeCall).toBeTruthy();
      const init = resumeCall![1] as RequestInit;
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({
        thread_id: "t-int",
        decisions: [{ tool_call_id: "tc-int-1", type: "approve" }],
      });
    });
  });

  it("clicking a Suggestion chip triggers a new send", async () => {
    const events: AgentEvent[] = [
      { type: "suggestion", items: ["Highlight more", "Open note"] },
      { type: "done", thread_id: "t-sug" },
    ];
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      streamResponse(events),
    );

    const sent = vi.fn();
    render(<AgentTranscript threadId="t-sug" onSendMessage={sent} />);

    // First send to get the suggestion stream rendered. onSendMessage override
    // means defaultSend (which does fetch) is skipped, so we need to trigger
    // the stream another way: mock fetch path above won't be hit when override
    // is set. Switch strategy: pre-seed stream by removing override, then
    // clicking a chip should re-route through onSendMessage when re-rendered.
    sent.mockReset();

    cleanup();
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      streamResponse(events),
    );
    render(<AgentTranscript threadId="t-sug" />);
    const ta = screen.getByLabelText("Message agent") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "kick" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    const chip = await waitFor(() =>
      screen.getByRole("button", { name: /highlight more/i }),
    );

    // Reset fetch mock to capture the suggestion-triggered send.
    (fetch as unknown as ReturnType<typeof vi.fn>).mockClear();
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      streamResponse([{ type: "done", thread_id: "t-sug" }]),
    );

    fireEvent.click(chip);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/agents/km/invoke",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("Highlight more"),
        }),
      );
    });
  });
});
