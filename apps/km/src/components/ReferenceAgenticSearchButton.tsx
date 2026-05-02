"use client";

import { Button } from "@/components/ui/button";
import { useAgentBall } from "@/components/agent/agent-ball-context";

interface Props {
  referenceId: string;
  citationKey: string;
}

export function ReferenceAgenticSearchButton({ referenceId, citationKey }: Props) {
  const { openWithPrompt } = useAgentBall();

  return (
    <Button
      variant="outline"
      size="sm"
      type="button"
      onClick={() =>
        openWithPrompt(
          `Find a paper PDF for this reference: ${citationKey}\nReference ID: ${referenceId}`,
          "paper-search",
        )
      }
    >
      <span aria-hidden="true" className="text-sm leading-none">⬡</span>
      🪄 Agentic PDF Search
    </Button>
  );
}