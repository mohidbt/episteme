"use client";

import { Sparkles } from "lucide-react";
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
      <Sparkles className="h-4 w-4" aria-hidden />
      🪄 Agentic PDF Search
    </Button>
  );
}