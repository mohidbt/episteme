/**
 * SSE agent event types — v1 matrix locked in 1.3a (Task 7).
 *
 * Mirrors the Python TypedDicts in services/agents/lib/sse_events.py.
 * Discriminated union on `type` enables exhaustive switch in consumers.
 *
 * Emit ownership:
 *   1.3a: text, tool_call, tool_result, interrupt, done
 *   1.3b: todos, sources, thinking, skill_load, suggestion
 *   1.3c: file_diff (Next.js side)
 */

export interface Citation {
  chunk_id: string;
  title?: string;
  url?: string;
  page?: number;
}

export type AgentEvent =
  | { type: "text"; id: string; delta: string }
  | { type: "thinking"; id: string; step_id?: string; delta: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      args: Record<string, unknown>;
      state: "input-available";
    }
  | {
      type: "tool_result";
      id: string;
      output?: unknown;
      errorText?: string;
      state: "output-available" | "output-error";
    }
  | {
      type: "interrupt";
      id: string;
      tool: string;
      args: Record<string, unknown>;
      allowed_decisions: string[];
    }
  | {
      type: "todos";
      items: Array<{
        id: string;
        content: string;
        status: "pending" | "in_progress" | "completed";
      }>;
    }
  | { type: "sources"; message_id: string; citations: Array<Citation> }
  | { type: "skill_load"; name: string }
  | {
      type: "file_diff";
      note_id: string;
      before_hash: string;
      after_hash: string;
      diff: string;
    }
  | { type: "suggestion"; items: string[] }
  | { type: "done"; thread_id: string };

export const AGENT_EVENT_TYPES = [
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
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];
