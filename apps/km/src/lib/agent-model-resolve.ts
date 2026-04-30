/**
 * Pure resolver for the 3-level agent model cascade.
 *
 * Cascade (most-specific wins):
 *   agent_threads.model_override
 *     -> skill frontmatter `model:`
 *     -> agent_configs.model_preference
 *     -> DEFAULT_MODEL
 *
 * No I/O. Consumers (server actions, invoke proxy, ModelPicker UI) are
 * responsible for fetching the inputs and passing them in.
 */

export const DEFAULT_MODEL = "google/gemma-4-26b-a4b-it";

export interface ModelCascadeInput {
  /** From `agent_configs.model_preference` (NOT NULL in schema). */
  userPreference: string;
  /** From skill frontmatter `model:`. Optional. */
  skillModel?: string | null;
  /** From `agent_threads.model_override`. Optional. */
  threadOverride?: string | null;
}

function firstSet(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveAgentModel(input: ModelCascadeInput): string {
  return (
    firstSet(input.threadOverride) ??
    firstSet(input.skillModel) ??
    firstSet(input.userPreference) ??
    DEFAULT_MODEL
  );
}
