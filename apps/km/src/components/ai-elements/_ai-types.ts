/**
 * Local stand-ins for the `ai` package types used by AI Elements components.
 *
 * Episteme's LLM call path is Python-side (LangChain `astream_events` v2 → typed SSE),
 * so we don't depend on the AI SDK runtime. AI Elements only consumes these types
 * structurally — keeping them local removes the `ai` dependency.
 */

export type UIMessageRole = "system" | "user" | "assistant";

export interface UITextPart {
  type: "text";
  text: string;
}

export interface UIMessage {
  id?: string;
  role: UIMessageRole;
  parts: Array<UITextPart | { type: string; [k: string]: unknown }>;
}

export type ToolUIPartState =
  | "approval-requested"
  | "approval-responded"
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-denied"
  | "output-error";

export interface ToolUIPart {
  type: `tool-${string}`;
  state: ToolUIPartState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

export interface DynamicToolUIPart {
  type: "dynamic-tool";
  state: ToolUIPartState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}
