// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
}));

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

  it("seeds the transcript from initialMessages on mount (Task #41)", () => {
    render(
      <AgentTranscript
        threadId="t1"
        initialMessages={[
          { id: "u-1", role: "user", text: "hello agent" },
          { id: "a-1", role: "assistant", text: "hi there" },
        ]}
      />,
    );
    expect(screen.queryByText(/no messages yet/i)).toBeNull();
    expect(screen.getByText("hello agent")).toBeTruthy();
    expect(screen.getByText("hi there")).toBeTruthy();
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

  it("forwards pageContext in the invoke body so the agent grounds to the open note (Task #27)", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      streamResponse([{ type: "done", thread_id: "t-pc" }]),
    );

    render(
      <AgentTranscript
        threadId="t-pc"
        pageContext={{ noteId: "my-current-note" }}
      />,
    );
    const ta = screen.getByLabelText("Message agent") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "summarise this" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls;
      const invoke = calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("/api/agents/km/invoke"),
      );
      expect(invoke).toBeTruthy();
      const body = JSON.parse((invoke![1] as RequestInit).body as string);
      expect(body.page_context).toEqual({ noteId: "my-current-note" });
      expect(body.thread_id).toBe("t-pc");
      expect(body.message).toBe("summarise this");
    });
  });

  it("renders memory pill (Recalling/Saving memory) for /memories/ tool ops, hides raw payload by default (G15 #40)", async () => {
    const events: AgentEvent[] = [
      {
        type: "tool_call",
        id: "mem-r",
        name: "read_file",
        args: { file_path: "/memories/preferences.md" },
        state: "input-available",
      },
      {
        type: "tool_result",
        id: "mem-r",
        output: "user prefers dark mode SECRET_PAYLOAD_X",
        state: "output-available",
      },
      {
        type: "tool_call",
        id: "mem-w",
        name: "write_file",
        args: {
          file_path: "/memories/notes.md",
          content: "TOPSECRET_MEMORY_CONTENTS",
        },
        state: "input-available",
      },
      { type: "done", thread_id: "t-mem" },
    ];
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      streamResponse(events),
    );

    render(<AgentTranscript threadId="t-mem" />);
    const ta = screen.getByLabelText("Message agent") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "go" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      // After result, read tool moves to output-available -> "Recalled memory"
      expect(screen.getByText(/recalled memory/i)).toBeTruthy();
      expect(screen.getByText(/saving memory/i)).toBeTruthy();
    });

    // Raw payload (memory contents) NOT in DOM by default — Task is collapsed.
    expect(screen.queryByText(/TOPSECRET_MEMORY_CONTENTS/)).toBeNull();
    expect(screen.queryByText(/SECRET_PAYLOAD_X/)).toBeNull();

    // Both memory cards exist with data-memory-op attribute
    const memCards = screen
      .getAllByTestId("card-tool")
      .filter((el) => el.getAttribute("data-memory-op"));
    expect(memCards.length).toBe(2);
  });

  it("Task #10: input row centers textarea with items-center and equal padding (G9)", () => {
    render(<AgentTranscript threadId="t-align" />);
    const ta = screen.getByLabelText("Message agent") as HTMLTextAreaElement;
    const row = ta.parentElement!;
    expect(row.className).toContain("flex");
    expect(row.className).toContain("items-center");
    // equal L/R padding via single p-* token (e.g. p-2) — not split px-/py-
    expect(/\bp-2\b/.test(row.className)).toBe(true);
  });

  it("Task #33: successful tool card has no Check icon and Tool collapsed by default (G9)", async () => {
    const events: AgentEvent[] = [
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
      { type: "done", thread_id: "t-tool" },
    ];
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      streamResponse(events),
    );

    render(<AgentTranscript threadId="t-tool" />);
    const ta = screen.getByLabelText("Message agent") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "go" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    const toolCard = await waitFor(() => screen.getByTestId("card-tool"));

    // No green check icon (lucide adds class lucide-circle-check or similar).
    const checks = toolCard.querySelectorAll(
      '[class*="lucide-circle-check"], [class*="lucide-check"]',
    );
    expect(checks.length).toBe(0);

    // Base UI Collapsible exposes `data-state` on the panel/root and uses
    // `aria-expanded` on the trigger. By default the tool card must be
    // collapsed: trigger reports aria-expanded="false".
    const trigger = toolCard.querySelector('[data-slot="collapsible-trigger"]');
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  });

  it("Task #42: ConversationContent uses tightened gap (gap-3) for chat spacing (G9)", () => {
    render(<AgentTranscript threadId="t-gap" />);
    const log = screen.getByRole("log");
    // ConversationContent is the inner stick-to-bottom content div
    const content = log.querySelector('[class*="flex-col"]');
    expect(content).toBeTruthy();
    expect(content!.className).toContain("gap-3");
    expect(content!.className).not.toContain("gap-8");
  });

  it("Task #43: prompt input is a field-sizing textarea capped at 8 rows (G9)", () => {
    render(<AgentTranscript threadId="t-grow" />);
    const ta = screen.getByLabelText("Message agent") as HTMLTextAreaElement;
    // shadcn Textarea sets data-slot="textarea" and uses field-sizing-content
    expect(ta.getAttribute("data-slot")).toBe("textarea");
    expect(ta.className).toContain("field-sizing-content");
    // Cap at ~8 rows. Using max-h-48 (12rem) as the cap token.
    expect(/max-h-48/.test(ta.className)).toBe(true);
  });

  it("Task #45: editing a past user message truncates following messages and re-invokes (fork)", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    // First send: produces user msg "first" + assistant "reply one"
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        { type: "text", id: "a1", delta: "reply one" },
        { type: "done", thread_id: "t-fork" },
      ] as AgentEvent[]),
    );
    // Second send: triggered by fork submit
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        { type: "text", id: "a2", delta: "edited reply" },
        { type: "done", thread_id: "t-fork" },
      ] as AgentEvent[]),
    );

    render(<AgentTranscript threadId="t-fork" />);
    const ta = screen.getByLabelText("Message agent") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "first" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    // wait for assistant reply rendered
    await waitFor(() => {
      const assistant = screen
        .getAllByTestId("card-text")
        .find((el) => el.getAttribute("data-role") === "assistant");
      expect(assistant?.textContent).toContain("reply one");
    });

    // Click edit button on user msg
    const editBtn = screen.getByLabelText(/edit message/i);
    fireEvent.click(editBtn);
    const editInput = screen.getByLabelText(/edit user message/i) as HTMLTextAreaElement;
    fireEvent.change(editInput, { target: { value: "first edited" } });
    fireEvent.click(screen.getByRole("button", { name: /submit edit/i }));

    // After fork: only the new user message + new assistant reply visible
    await waitFor(() => {
      const userCards = screen
        .getAllByTestId("card-text")
        .filter((el) => el.getAttribute("data-role") === "user");
      expect(userCards.length).toBe(1);
      expect(userCards[0].textContent).toContain("first edited");
    });
    // old assistant reply gone
    expect(screen.queryByText("reply one")).toBeNull();

    // Last fetch call body should contain the edited prompt
    const calls = fetchMock.mock.calls;
    const last = calls[calls.length - 1];
    const body = JSON.parse((last[1] as RequestInit).body as string);
    expect(body.message).toBe("first edited");
  });

  it("RG3 #57 — edit pencil renders below the user bubble (sibling, not absolute overlay) with hover-reveal classes and Pencil icon", () => {
    render(
      <AgentTranscript
        threadId="t-pencil"
        initialMessages={[{ id: "u-1", role: "user", text: "hello world" }]}
      />,
    );
    const editBtn = screen.getByLabelText(/edit message/i);
    // Icon-only: no visible text label like "Edit"
    expect(editBtn.textContent?.trim()).toBe("");
    // Lucide Pencil icon present
    const icon = editBtn.querySelector("svg");
    expect(icon).toBeTruthy();
    expect(icon!.classList.contains("lucide-pencil")).toBe(true);
    // Hover-reveal classes
    const cls = editBtn.className;
    expect(cls).toContain("opacity-0");
    expect(cls).toContain("group-hover:opacity-100");
    expect(cls).toContain("transition-opacity");
    // Not an absolute overlay (would cover the bubble text)
    expect(cls).not.toContain("absolute");
    // Sibling of the Message bubble: previousElementSibling is the bubble.
    const card = editBtn.closest('[data-testid="card-text"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(editBtn.previousElementSibling).not.toBeNull();
    // Bubble text "hello world" lives in a sibling node, not inside the button.
    expect(editBtn.textContent).not.toContain("hello world");
  });

  it("RG3 #58 — assistant message uses tightened line-height; user bubble unchanged", () => {
    render(
      <AgentTranscript
        threadId="t-leading"
        initialMessages={[
          { id: "u-1", role: "user", text: "user msg" },
          { id: "a-1", role: "assistant", text: "assistant msg" },
        ]}
      />,
    );
    const cards = screen.getAllByTestId("card-text");
    const userCard = cards.find((c) => c.getAttribute("data-role") === "user")!;
    const assistantCard = cards.find(
      (c) => c.getAttribute("data-role") === "assistant",
    )!;
    // The MessageResponse (Streamdown root) sits inside the assistant card
    // and must carry an explicit tighter leading class for prose paragraphs.
    const assistantResponse = assistantCard.querySelector(
      "[data-streamdown='root'], .size-full",
    ) as HTMLElement | null;
    expect(assistantResponse).toBeTruthy();
    const aCls = assistantResponse!.className;
    // Tightened — leading-snug (1.375) on assistant prose paragraphs
    expect(/\bleading-snug\b/.test(aCls) || /\[&_p\]:leading-snug/.test(aCls)).toBe(true);

    // User bubble is NOT tightened with the assistant-only class (sanity:
    // assistant-only override doesn't leak into user MessageResponse).
    const userResponse = userCard.querySelector(
      "[data-streamdown='root'], .size-full",
    ) as HTMLElement | null;
    expect(userResponse).toBeTruthy();
    expect(/\[&_p\]:leading-snug/.test(userResponse!.className)).toBe(false);
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
