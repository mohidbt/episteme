"use client";

import type { Skill } from "@/lib/skills";

export interface SkillsSectionProps {
  skills: readonly Skill[];
}

export function SkillsSection({ skills }: SkillsSectionProps) {
  return (
    <section data-testid="agents-skills-section" className="flex flex-col gap-3">
      <h2 className="font-display text-xl leading-none tracking-tight">Skills</h2>
      <ul className="grid gap-3 sm:grid-cols-2" data-testid="agents-skills-list">
        {skills.map((skill) => (
          <li
            key={skill.name}
            data-testid="agents-skill-row"
            data-skill={skill.name}
            className="rounded-md border border-border/60 bg-background p-3"
          >
            <div className="text-sm font-medium">{skill.title}</div>
            <p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
