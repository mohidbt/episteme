"use client";

import { Card, CardContent } from "@/components/ui/card";
import { BookOpenIcon } from "lucide-react";
import { humanizeToolName } from "@/lib/agents/tool-categories";

export interface SkillLoadCardProps {
  name: string;
}

/**
 * Episteme-specific transcript card emitted by `skill_load` SSE event.
 * GSD-30: prettify snake_case skill slugs for display (raw `name` is
 * preserved on `data-skill` so test selectors keep working).
 */
export function SkillLoadCard({ name }: SkillLoadCardProps) {
  const pretty = humanizeToolName(name);
  return (
    <Card data-testid="card-skill_load" className="py-2">
      <CardContent className="px-3 py-1 text-xs">
        <button
          type="button"
          data-skill={name}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
          onClick={() => {
            /* TODO: open SKILL.md preview modal */
          }}
        >
          <BookOpenIcon className="size-3.5" />
          <span>
            Loaded skill: <span className="font-medium">{pretty}</span>
          </span>
        </button>
      </CardContent>
    </Card>
  );
}
