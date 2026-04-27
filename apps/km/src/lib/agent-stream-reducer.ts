/**
 * Pure-function reducer over `AgentEvent` → `AgentTranscriptState`.
 *
 * Folds a stream of typed SSE events (see `agent-events.ts`) into an
 * ordered list of "cards" plus side-channel state (todos, sources by
 * message_id, pending interrupts). Consumed by AgentTranscript / AI
 * Elements UI in tasks #6–#8.
 *
 * Invariants:
 *   - text/thinking deltas with same `id` accumulate into one card.
 *   - tool_call creates a tool card; tool_result with matching id
 *     transitions state input-available → output-available|output-error.
 *   - tool_result without prior tool_call is a no-op + console.warn.
 *   - interrupt appends a card AND pushes onto pendingInterrupts.
 *   - todos events fully replace the todos sidecar (server-canonical).
 *   - done sets terminated=true; further events are ignored + warned.
 *   - Unknown event.type is a TypeScript compile error (exhaustive
 *     switch via `never`); at runtime no-op + console.warn.
 *
 * Pure data → data. No React, no DOM, no fetch.
 */

import type { AgentEvent, Citation } from "./agent-events";

export type TodoItem = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
};

export interface TextCard {
  kind: "text";
  id: string;
  text: string;
}

export interface ThinkingCard {
  kind: "thinking";
  id: string;
  stepId?: string;
  text: string;
}

export interface ToolCard {
  kind: "tool";
  id: string;
  name: string;
  args: Record<string, unknown>;
  state: "input-available" | "output-available" | "output-error";
  output?: unknown;
  errorText?: string;
}

export interface InterruptCard {
  kind: "interrupt";
  id: string;
  tool: string;
  args: Record<string, unknown>;
  allowedDecisions: string[];
}

export interface SkillLoadCard {
  kind: "skill_load";
  name: string;
}

export interface FileDiffCard {
  kind: "file_diff";
  noteId: string;
  beforeHash: string;
  afterHash: string;
  diff: string;
}

export interface SuggestionCard {
  kind: "suggestion";
  items: string[];
}

export type TranscriptCard =
  | TextCard
  | ThinkingCard
  | ToolCard
  | InterruptCard
  | SkillLoadCard
  | FileDiffCard
  | SuggestionCard;

export interface AgentTranscriptState {
  cards: TranscriptCard[];
  todos: TodoItem[];
  sourcesByMessage: Record<string, Citation[]>;
  pendingInterrupts: InterruptCard[];
  terminated: boolean;
}

export const initialAgentTranscriptState: AgentTranscriptState = {
  cards: [],
  todos: [],
  sourcesByMessage: {},
  pendingInterrupts: [],
  terminated: false,
};

export function agentStreamReducer(
  state: AgentTranscriptState,
  event: AgentEvent,
): AgentTranscriptState {
  if (state.terminated) {
    console.warn(
      `[agent-stream-reducer] event "${event.type}" received after done; ignoring`,
    );
    return state;
  }

  switch (event.type) {
    case "text": {
      const idx = state.cards.findIndex(
        (c) => c.kind === "text" && c.id === event.id,
      );
      if (idx >= 0) {
        const prev = state.cards[idx] as TextCard;
        const merged: TextCard = {
          kind: "text",
          id: event.id,
          text: prev.text + event.delta,
        };
        const out = state.cards.slice();
        out[idx] = merged;
        return { ...state, cards: out };
      }
      const card: TextCard = {
        kind: "text",
        id: event.id,
        text: event.delta,
      };
      return { ...state, cards: [...state.cards, card] };
    }

    case "thinking": {
      const idx = state.cards.findIndex(
        (c) => c.kind === "thinking" && c.id === event.id,
      );
      if (idx >= 0) {
        const prev = state.cards[idx] as ThinkingCard;
        const merged: ThinkingCard = {
          kind: "thinking",
          id: event.id,
          stepId: event.step_id ?? prev.stepId,
          text: prev.text + event.delta,
        };
        const out = state.cards.slice();
        out[idx] = merged;
        return { ...state, cards: out };
      }
      const card: ThinkingCard = {
        kind: "thinking",
        id: event.id,
        stepId: event.step_id,
        text: event.delta,
      };
      return { ...state, cards: [...state.cards, card] };
    }

    case "tool_call": {
      const card: ToolCard = {
        kind: "tool",
        id: event.id,
        name: event.name,
        args: event.args,
        state: "input-available",
      };
      return { ...state, cards: [...state.cards, card] };
    }

    case "tool_result": {
      const idx = state.cards.findIndex(
        (c) => c.kind === "tool" && c.id === event.id,
      );
      if (idx < 0) {
        console.warn(
          `[agent-stream-reducer] tool_result id="${event.id}" has no matching tool_call; ignoring`,
        );
        return state;
      }
      const prev = state.cards[idx] as ToolCard;
      const merged: ToolCard = {
        ...prev,
        state: event.state,
        output: event.output,
        errorText: event.errorText,
      };
      const out = state.cards.slice();
      out[idx] = merged;
      return { ...state, cards: out };
    }

    case "interrupt": {
      const card: InterruptCard = {
        kind: "interrupt",
        id: event.id,
        tool: event.tool,
        args: event.args,
        allowedDecisions: event.allowed_decisions,
      };
      return {
        ...state,
        cards: [...state.cards, card],
        pendingInterrupts: [...state.pendingInterrupts, card],
      };
    }

    case "todos": {
      return { ...state, todos: event.items.slice() };
    }

    case "sources": {
      return {
        ...state,
        sourcesByMessage: {
          ...state.sourcesByMessage,
          [event.message_id]: event.citations.slice(),
        },
      };
    }

    case "skill_load": {
      const card: SkillLoadCard = { kind: "skill_load", name: event.name };
      return { ...state, cards: [...state.cards, card] };
    }

    case "file_diff": {
      const card: FileDiffCard = {
        kind: "file_diff",
        noteId: event.note_id,
        beforeHash: event.before_hash,
        afterHash: event.after_hash,
        diff: event.diff,
      };
      return { ...state, cards: [...state.cards, card] };
    }

    case "suggestion": {
      const card: SuggestionCard = {
        kind: "suggestion",
        items: event.items.slice(),
      };
      return { ...state, cards: [...state.cards, card] };
    }

    case "done": {
      return { ...state, terminated: true };
    }

    default: {
      // Exhaustive: TS will error here if a new AgentEvent variant is
      // added without a case. Runtime no-op + warn for forward-compat.
      const _exhaustive: never = event;
      console.warn(
        `[agent-stream-reducer] unknown event: ${JSON.stringify(_exhaustive)}`,
      );
      return state;
    }
  }
}
