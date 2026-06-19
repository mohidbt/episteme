"use client";

import { useCallback } from "react";
import { fetchOrThrowTrialExhausted } from "../lib/trial-exhausted";

export type UseExplainPassageOptions = {
  paperId: string;
  threadId?: string | null;
  onOpenPanel?: () => void;
};

export type ExplainPassageArgs = {
  page: number;
  text: string;
};

/**
 * Hook for triggering the KM agent's `pdf_explain_passage` tool by sending a
 * natural-language message to `/api/agents/km/invoke`. The agent's main LLM
 * has the tool registered (see Phase 1.6b Task 4) and will call it based on
 * tool advertising.
 *
 * The caller is responsible for ensuring `threadId` is non-null before
 * invocation — calling `explain` without an active thread throws.
 *
 * GSD-126 P1a: the underlying invoke route returns HTTP 402 + JSON
 * `{ error: "trial_exhausted" }` when the user's managed OpenRouter
 * bucket is drained. We surface that as `TrialExhaustedError` so the
 * caller can render the upgrade-prompt toast without reading the body.
 */
export function useExplainPassage({
  paperId,
  threadId,
  onOpenPanel,
}: UseExplainPassageOptions) {
  const explain = useCallback(
    async ({ page, text }: ExplainPassageArgs) => {
      if (!threadId) {
        throw new Error("useExplainPassage: threadId is required");
      }
      onOpenPanel?.();
      return fetchOrThrowTrialExhausted("/api/agents/km/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: threadId,
          message: `Explain this passage from page ${page} of paper ${paperId}: "${text}"`,
        }),
      });
    },
    [paperId, threadId, onOpenPanel]
  );
  return { explain };
}
