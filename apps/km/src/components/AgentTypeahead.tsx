"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

export interface AgentTypeaheadRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export interface AgentPick {
  skill: string;
}

export interface AgentTypeaheadProps {
  query: string;
  onSelect: (payload: AgentPick) => void;
}

/**
 * AgentTypeahead — fetches /api/agents/config on mount.
 *
 * Degraded state: if the endpoint returns 404, 401, or enabled_skills is empty,
 * shows a friendly empty state. The invoke flow (instruction dialog, streaming,
 * scratchpad) is Phase 1.3 work — TODO: wire up when 1.3 lands.
 */
export const AgentTypeahead = forwardRef<AgentTypeaheadRef, AgentTypeaheadProps>(
  function AgentTypeahead({ query, onSelect }, ref) {
    const [skills, setSkills] = useState<string[] | null>(null); // null = loading
    const [selected, setSelected] = useState(0);

    useEffect(() => {
      let cancelled = false;
      fetch("/api/agents/km/config")
        .then((r) => {
          if (!r.ok) return { enabledSkills: [] };
          return r.json() as Promise<{ enabledSkills: string[] }>;
        })
        .then((data) => {
          if (!cancelled) setSkills(data.enabledSkills ?? []);
        })
        .catch(() => {
          if (!cancelled) setSkills([]);
        });
      return () => { cancelled = true; };
    }, []);

    // Filter by query if provided
    const filtered =
      skills === null
        ? []
        : query.trim().length === 0
          ? skills
          : skills.filter((s) => s.toLowerCase().includes(query.toLowerCase()));

    useEffect(() => {
      setSelected(0);
    }, [filtered.length]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowUp") {
          setSelected((i) => (filtered.length === 0 ? 0 : (i + filtered.length - 1) % filtered.length));
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelected((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
          return true;
        }
        if (event.key === "Enter") {
          if (filtered.length > 0) {
            // TODO (Phase 1.3): open instruction dialog and invoke agent
            console.info("[/agent] skill selected (Phase 1.3 stub):", { skill: filtered[selected] });
            onSelect({ skill: filtered[selected] });
            return true;
          }
        }
        return false;
      },
    }));

    if (skills === null) {
      return (
        <div className="z-50 min-w-[260px] rounded-md border bg-popover p-2 text-sm text-muted-foreground shadow-md">
          Loading agents…
        </div>
      );
    }

    if (filtered.length === 0) {
      return (
        <div className="z-50 min-w-[260px] rounded-md border bg-popover p-2 text-sm text-muted-foreground shadow-md">
          No agents installed. Install from Phase 1.3.
        </div>
      );
    }

    return (
      <div className="z-50 min-w-[280px] rounded-md border bg-popover p-1 text-sm shadow-md">
        {filtered.map((skill, i) => (
          <button
            key={skill}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              // TODO (Phase 1.3): open instruction dialog and invoke agent
              console.info("[/agent] skill selected (Phase 1.3 stub):", { skill });
              onSelect({ skill });
            }}
            className={`w-full rounded px-2 py-1.5 text-left ${
              i === selected ? "bg-accent text-accent-foreground" : ""
            }`}
          >
            {skill}
          </button>
        ))}
      </div>
    );
  },
);
