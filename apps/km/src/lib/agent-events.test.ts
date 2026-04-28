/**
 * RED tests for agent-events.ts discriminated union (Task 7 / 1.3a).
 *
 * Type-level coverage: AGENT_EVENT_TYPES has exactly 13 members.
 * Runtime coverage: switch narrows AgentEvent to every variant.
 */

import { describe, it, expect } from "vitest";
import {
  AGENT_EVENT_TYPES,
  type AgentEvent,
  type AgentEventType,
} from "./agent-events";

describe("AGENT_EVENT_TYPES", () => {
  it("contains exactly 13 event types", () => {
    expect(AGENT_EVENT_TYPES).toHaveLength(13);
  });

  it("contains all expected event names", () => {
    const expected = [
      "text",
      "thinking",
      "tool_call",
      "tool_result",
      "interrupt",
      "todos",
      "sources",
      "skill_load",
      "file_diff",
      "suggestion",
      "done",
      "error",
      "recursion_step",
    ] as const;
    for (const name of expected) {
      expect(AGENT_EVENT_TYPES).toContain(name);
    }
  });
});

describe("AgentEvent discriminated union", () => {
  /**
   * Exhaustive switch over AgentEvent — TypeScript will error at compile time
   * if a variant is unhandled (the `never` branch catches it).
   */
  function getEventLabel(ev: AgentEvent): string {
    switch (ev.type) {
      case "text":
        return `text:${ev.delta}`;
      case "thinking":
        return `thinking:${ev.delta}`;
      case "tool_call":
        return `tool_call:${ev.name}`;
      case "tool_result":
        return `tool_result:${ev.state}`;
      case "interrupt":
        return `interrupt:${ev.tool}`;
      case "todos":
        return `todos:${ev.items.length}`;
      case "sources":
        return `sources:${ev.message_id}`;
      case "skill_load":
        return `skill_load:${ev.name}`;
      case "file_diff":
        return `file_diff:${ev.note_id}`;
      case "suggestion":
        return `suggestion:${ev.items.length}`;
      case "done":
        return `done:${ev.thread_id}`;
      case "error":
        return `error:${ev.code}`;
      case "recursion_step":
        return `recursion_step:${ev.step}`;
      default: {
        // exhaustive check — never reached at runtime
        const _exhaustive: never = ev;
        return _exhaustive;
      }
    }
  }

  it("narrows text event", () => {
    const ev: AgentEvent = { type: "text", id: "r1", delta: "hello" };
    expect(getEventLabel(ev)).toBe("text:hello");
  });

  it("narrows thinking event", () => {
    const ev: AgentEvent = { type: "thinking", id: "r2", delta: "hmm" };
    expect(getEventLabel(ev)).toBe("thinking:hmm");
  });

  it("narrows thinking event with optional step_id", () => {
    const ev: AgentEvent = {
      type: "thinking",
      id: "r2",
      step_id: "s1",
      delta: "hmm",
    };
    expect(ev.step_id).toBe("s1");
  });

  it("narrows tool_call event", () => {
    const ev: AgentEvent = {
      type: "tool_call",
      id: "tc1",
      name: "search",
      args: { q: "foo" },
      state: "input-available",
    };
    expect(getEventLabel(ev)).toBe("tool_call:search");
  });

  it("narrows tool_result output-available", () => {
    const ev: AgentEvent = {
      type: "tool_result",
      id: "tc1",
      output: "result",
      state: "output-available",
    };
    expect(getEventLabel(ev)).toBe("tool_result:output-available");
  });

  it("narrows tool_result output-error", () => {
    const ev: AgentEvent = {
      type: "tool_result",
      id: "tc1",
      errorText: "boom",
      state: "output-error",
    };
    expect(getEventLabel(ev)).toBe("tool_result:output-error");
  });

  it("narrows interrupt event", () => {
    const ev: AgentEvent = {
      type: "interrupt",
      id: "int1",
      tool: "delete_note",
      args: { note_id: "x" },
      allowed_decisions: ["approve", "reject"],
    };
    expect(getEventLabel(ev)).toBe("interrupt:delete_note");
  });

  it("narrows todos event", () => {
    const ev: AgentEvent = {
      type: "todos",
      items: [{ id: "t1", content: "do it", status: "pending" }],
    };
    expect(getEventLabel(ev)).toBe("todos:1");
  });

  it("narrows sources event", () => {
    const ev: AgentEvent = {
      type: "sources",
      message_id: "msg-1",
      citations: [{ chunk_id: "c1" }],
    };
    expect(getEventLabel(ev)).toBe("sources:msg-1");
  });

  it("narrows skill_load event", () => {
    const ev: AgentEvent = { type: "skill_load", name: "rag-search" };
    expect(getEventLabel(ev)).toBe("skill_load:rag-search");
  });

  it("narrows file_diff event", () => {
    const ev: AgentEvent = {
      type: "file_diff",
      note_id: "n1",
      before_hash: "abc",
      after_hash: "def",
      diff: "@@ ...",
    };
    expect(getEventLabel(ev)).toBe("file_diff:n1");
  });

  it("narrows suggestion event", () => {
    const ev: AgentEvent = {
      type: "suggestion",
      items: ["Try X", "Try Y"],
    };
    expect(getEventLabel(ev)).toBe("suggestion:2");
  });

  it("narrows done event", () => {
    const ev: AgentEvent = { type: "done", thread_id: "t-123" };
    expect(getEventLabel(ev)).toBe("done:t-123");
  });

  it("narrows error event", () => {
    const ev: AgentEvent = {
      type: "error",
      code: "rate_limited",
      message: "upstream 429",
      retriable: true,
    };
    expect(getEventLabel(ev)).toBe("error:rate_limited");
  });

  it("narrows recursion_step event", () => {
    const ev: AgentEvent = { type: "recursion_step", step: 10 };
    expect(getEventLabel(ev)).toBe("recursion_step:10");
  });
});

describe("AgentEventType", () => {
  it("is assignable from each event type string", () => {
    // Type-level — just confirm runtime constant is stable
    const types: AgentEventType[] = [...AGENT_EVENT_TYPES];
    expect(types).toHaveLength(13);
  });
});
