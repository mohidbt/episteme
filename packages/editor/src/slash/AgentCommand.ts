import type { Editor } from "@tiptap/core";

export interface AgentCommandPayload {
  skill: string;
}

/**
 * Stub handler for /agent slash command.
 *
 * TODO (Phase 1.3): Replace this stub with the full invoke flow:
 *   - Open instruction input dialog
 *   - POST /api/agents/km/invoke with { skill, instruction, context }
 *   - Stream result into a scratchpad pane
 *   - Show HITL approval prompts for require_approval agents
 *
 * For now, logs the selection and closes the menu (no-op on the document).
 */
export function invokeAgent(_editor: Editor, payload: AgentCommandPayload): void {
  console.info(`[/agent] agent selected — skill: ${payload.skill} (Phase 1.3 stub)`, payload);
  // No-op: document is unchanged until Phase 1.3 implements the invoke flow.
}
