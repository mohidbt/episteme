"use client";

import { Button } from "@/components/ui/button";
import { useAgentBall } from "@/components/agent/agent-ball-context";

interface Props {
  referenceId: string;
  citationKey: string;
  /** When truthy, the reference is already linked to a library paper, so
   *  agentic PDF search is unnecessary and the button is disabled. */
  identityPaper?: unknown;
}

export function ReferenceAgenticSearchButton({
  referenceId,
  citationKey,
  identityPaper,
}: Props) {
  const { openWithPrompt } = useAgentBall();

  return (
    <Button
      variant="outline"
      size="sm"
      type="button"
      data-testid="reference-agentic-search"
      disabled={!!identityPaper}
      onClick={() =>
        openWithPrompt(
          `Find a paper PDF for this reference: ${citationKey}\nReference ID: ${referenceId}`,
          "paper-search",
        )
      }
    >
      <span aria-hidden="true" className="text-sm leading-none">⬡</span>
      Agentic PDF Search
    </Button>
  );
}
