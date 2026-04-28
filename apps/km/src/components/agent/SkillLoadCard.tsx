"use client";

import { Card, CardContent } from "@/components/ui/card";
import { BookOpenIcon } from "lucide-react";

export interface SkillLoadCardProps {
  name: string;
}

/**
 * Episteme-specific transcript card emitted by `skill_load` SSE event.
 * MVP: notice + click target (no-op). Modal preview deferred.
 */
export function SkillLoadCard({ name }: SkillLoadCardProps) {
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
            Loaded skill: <span className="font-medium">{name}</span>
          </span>
        </button>
      </CardContent>
    </Card>
  );
}
