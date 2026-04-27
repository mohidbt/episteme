/**
 * Tests for agent-stream-reducer (Task 1 / 1.3c).
 *
 * Pure-function reducer over AgentEvent → AgentTranscriptState.
 * Covers: stable IDs, delta accumulation, tool_call→tool_result merge,
 * interrupts, todos replacement, sources keying, terminal `done`,
 * and replay of fixture streams.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentEvent } from "./agent-events";
import {
  agentStreamReducer,
  initialAgentTranscriptState,
  type AgentTranscriptState,
  type TextCard,
  type ToolCard,
  type InterruptCard,
} from "./agent-stream-reducer";

const fold = (events: AgentEvent[]): AgentTranscriptState =>
  events.reduce(agentStreamReducer, initialAgentTranscriptState);

const loadFixture = (name: string): AgentEvent[] => {
  const p = resolve(__dirname, "../../e2e/fixtures", name);
  return JSON.parse(readFileSync(p, "utf-8")) as AgentEvent[];
};

describe("initialAgentTranscriptState", () => {
  it("starts empty and not terminated", () => {
    expect(initialAgentTranscriptState).toEqual({
      cards: [],
      todos: [],
      sourcesByMessage: {},
      pendingInterrupts: [],
      terminated: false,
    });
  });
});

describe("agentStreamReducer — text events", () => {
  it("creates one text card from a single text event", () => {
    const s = fold([{ type: "text", id: "r1", delta: "hello" }]);
    expect(s.cards).toHaveLength(1);
    const c = s.cards[0] as TextCard;
    expect(c.kind).toBe("text");
    expect(c.id).toBe("r1");
    expect(c.text).toBe("hello");
  });

  it("concatenates deltas with the same id into one card", () => {
    const s = fold([
      { type: "text", id: "r1", delta: "hel" },
      { type: "text", id: "r1", delta: "lo " },
      { type: "text", id: "r1", delta: "world" },
    ]);
    expect(s.cards).toHaveLength(1);
    expect((s.cards[0] as TextCard).text).toBe("hello world");
  });

  it("creates separate cards for different ids in arrival order", () => {
    const s = fold([
      { type: "text", id: "a", delta: "first" },
      { type: "text", id: "b", delta: "second" },
      { type: "text", id: "a", delta: "!" },
    ]);
    expect(s.cards).toHaveLength(2);
    expect((s.cards[0] as TextCard).id).toBe("a");
    expect((s.cards[0] as TextCard).text).toBe("first!");
    expect((s.cards[1] as TextCard).id).toBe("b");
    expect((s.cards[1] as TextCard).text).toBe("second");
  });
});

describe("agentStreamReducer — thinking events", () => {
  it("accumulates thinking deltas with same id", () => {
    const s = fold([
      { type: "thinking", id: "t1", delta: "Let me " },
      { type: "thinking", id: "t1", delta: "think." },
    ]);
    expect(s.cards).toHaveLength(1);
    expect(s.cards[0].kind).toBe("thinking");
  });

  it("preserves step_id on thinking card when provided", () => {
    const s = fold([
      { type: "thinking", id: "t1", step_id: "s1", delta: "x" },
    ]);
    const c = s.cards[0];
    if (c.kind !== "thinking") throw new Error("expected thinking");
    expect(c.stepId).toBe("s1");
    expect(c.text).toBe("x");
  });
});

describe("agentStreamReducer — tool events", () => {
  it("tool_call followed by tool_result merges to one tool card", () => {
    const s = fold([
      {
        type: "tool_call",
        id: "tc1",
        name: "search",
        args: { q: "foo" },
        state: "input-available",
      },
      {
        type: "tool_result",
        id: "tc1",
        output: { hits: 3 },
        state: "output-available",
      },
    ]);
    expect(s.cards).toHaveLength(1);
    const c = s.cards[0] as ToolCard;
    expect(c.kind).toBe("tool");
    expect(c.id).toBe("tc1");
    expect(c.name).toBe("search");
    expect(c.state).toBe("output-available");
    expect(c.output).toEqual({ hits: 3 });
  });

  it("tool_result with errorText sets output-error", () => {
    const s = fold([
      {
        type: "tool_call",
        id: "tc1",
        name: "search",
        args: {},
        state: "input-available",
      },
      {
        type: "tool_result",
        id: "tc1",
        errorText: "boom",
        state: "output-error",
      },
    ]);
    const c = s.cards[0] as ToolCard;
    expect(c.state).toBe("output-error");
    expect(c.errorText).toBe("boom");
  });

  it("orphan tool_result without prior tool_call warns and is no-op", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = fold([
      {
        type: "tool_result",
        id: "ghost",
        output: "x",
        state: "output-available",
      },
    ]);
    expect(s.cards).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("agentStreamReducer — interrupt events", () => {
  it("appends interrupt card and adds to pendingInterrupts", () => {
    const s = fold([
      {
        type: "interrupt",
        id: "i1",
        tool: "delete_note",
        args: { note_id: "n1" },
        allowed_decisions: ["approve", "reject"],
      },
    ]);
    expect(s.cards).toHaveLength(1);
    const c = s.cards[0] as InterruptCard;
    expect(c.kind).toBe("interrupt");
    expect(c.id).toBe("i1");
    expect(c.tool).toBe("delete_note");
    expect(s.pendingInterrupts).toHaveLength(1);
    expect(s.pendingInterrupts[0].id).toBe("i1");
  });
});

describe("agentStreamReducer — todos events", () => {
  it("replaces todos array entirely", () => {
    const s = fold([
      {
        type: "todos",
        items: [{ id: "1", content: "a", status: "pending" }],
      },
      {
        type: "todos",
        items: [
          { id: "1", content: "a", status: "completed" },
          { id: "2", content: "b", status: "in_progress" },
        ],
      },
    ]);
    expect(s.todos).toHaveLength(2);
    expect(s.todos[0].status).toBe("completed");
    expect(s.todos[1].id).toBe("2");
    expect(s.cards).toHaveLength(0);
  });
});

describe("agentStreamReducer — sources events", () => {
  it("stores citations under message_id", () => {
    const s = fold([
      {
        type: "sources",
        message_id: "msg-1",
        citations: [{ chunk_id: "c1", title: "A" }],
      },
    ]);
    expect(s.sourcesByMessage["msg-1"]).toHaveLength(1);
    expect(s.sourcesByMessage["msg-1"][0].chunk_id).toBe("c1");
  });

  it("multiple sources events for different ids coexist", () => {
    const s = fold([
      {
        type: "sources",
        message_id: "msg-1",
        citations: [{ chunk_id: "c1" }],
      },
      {
        type: "sources",
        message_id: "msg-2",
        citations: [{ chunk_id: "c2" }, { chunk_id: "c3" }],
      },
    ]);
    expect(Object.keys(s.sourcesByMessage)).toHaveLength(2);
    expect(s.sourcesByMessage["msg-1"]).toHaveLength(1);
    expect(s.sourcesByMessage["msg-2"]).toHaveLength(2);
  });
});

describe("agentStreamReducer — skill_load / file_diff / suggestion", () => {
  it("appends skill_load card", () => {
    const s = fold([{ type: "skill_load", name: "rag-search" }]);
    expect(s.cards).toHaveLength(1);
    const c = s.cards[0];
    if (c.kind !== "skill_load") throw new Error("expected skill_load");
    expect(c.name).toBe("rag-search");
  });

  it("appends file_diff card", () => {
    const s = fold([
      {
        type: "file_diff",
        note_id: "n1",
        before_hash: "a",
        after_hash: "b",
        diff: "@@",
      },
    ]);
    const c = s.cards[0];
    if (c.kind !== "file_diff") throw new Error("expected file_diff");
    expect(c.noteId).toBe("n1");
    expect(c.diff).toBe("@@");
  });

  it("appends suggestion card", () => {
    const s = fold([{ type: "suggestion", items: ["X", "Y"] }]);
    const c = s.cards[0];
    if (c.kind !== "suggestion") throw new Error("expected suggestion");
    expect(c.items).toEqual(["X", "Y"]);
  });
});

describe("agentStreamReducer — done & termination", () => {
  it("done event sets terminated=true and adds no card", () => {
    const s = fold([{ type: "done", thread_id: "t1" }]);
    expect(s.terminated).toBe(true);
    expect(s.cards).toHaveLength(0);
  });

  it("ignores events received after done", () => {
    let warn: ReturnType<typeof vi.spyOn> | null = null;
    try {
      warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const s = fold([
        { type: "text", id: "r1", delta: "hi" },
        { type: "done", thread_id: "t1" },
        { type: "text", id: "r2", delta: "ignored" },
      ]);
      expect(s.terminated).toBe(true);
      expect(s.cards).toHaveLength(1);
      expect((s.cards[0] as TextCard).text).toBe("hi");
    } finally {
      warn?.mockRestore();
    }
  });
});

describe("agentStreamReducer — fixture replay", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("replays text-only fixture", () => {
    const s = fold(loadFixture("agent-stream-text-only.json"));
    expect(s.terminated).toBe(true);
    expect(s.cards).toHaveLength(1);
    expect(s.cards[0].kind).toBe("text");
    expect((s.cards[0] as TextCard).text.length).toBeGreaterThan(0);
  });

  it("replays tool_call happy-path fixture", () => {
    const s = fold(loadFixture("agent-stream-tool-call.json"));
    expect(s.terminated).toBe(true);
    const tool = s.cards.find((c) => c.kind === "tool") as
      | ToolCard
      | undefined;
    expect(tool).toBeDefined();
    expect(tool?.state).toBe("output-available");
  });

  it("replays interrupt fixture", () => {
    const s = fold(loadFixture("agent-stream-interrupt.json"));
    expect(s.terminated).toBe(true);
    expect(s.pendingInterrupts.length).toBeGreaterThan(0);
    expect(s.cards.some((c) => c.kind === "interrupt")).toBe(true);
  });

  it("replays deep-read fixture covering all card kinds", () => {
    const s = fold(loadFixture("agent-stream-deep-read.json"));
    expect(s.terminated).toBe(true);
    const kinds = new Set(s.cards.map((c) => c.kind));
    expect(kinds.has("skill_load")).toBe(true);
    expect(kinds.has("thinking")).toBe(true);
    expect(kinds.has("tool")).toBe(true);
    expect(kinds.has("file_diff")).toBe(true);
    expect(s.todos.length).toBeGreaterThan(0);
    expect(Object.keys(s.sourcesByMessage).length).toBeGreaterThan(0);
  });
});
