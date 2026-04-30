// Canonical list of agent skills exposed to the UI.
// Used by the settings SkillToggles and by the inline AI rephrase skill picker.
// Each skill carries an instruction string used as a rephrase/writing prompt.

/**
 * Skill category. Controls where the skill surfaces in UI:
 * - "writing": eligible for the inline rephrase / writing skill picker.
 * - "research": research-flavored skills (paper search, triage, deep read).
 *
 * The rephrase popover only lists `writing` skills (#70). When personal
 * skills land (G-R3-03) they will declare their own category via SKILL.md
 * frontmatter and we'll filter the same way.
 */
export type SkillCategory = "writing" | "research";

export type Skill = {
  name: string;
  title: string;
  description: string;
  /** Instruction text used when the skill is applied as a rephrase prompt. */
  instruction: string;
  category: SkillCategory;
};

export const SKILLS: readonly Skill[] = [
  {
    name: "paper-search",
    title: "Paper Search",
    description: "Find and download paper PDFs for references using Semantic Scholar.",
    instruction:
      "Rewrite as a concise, actionable paper-search query suitable for an academic database.",
    category: "research",
  },
  {
    name: "lit-triage",
    title: "Literature Triage",
    description: "Skim incoming references and decide what's worth a deeper read.",
    instruction:
      "Rewrite as a brief triage note: state the claim, why it matters, and whether to read deeper.",
    category: "research",
  },
  {
    name: "deep-read",
    title: "Deep Read",
    description: "Read papers thoroughly and extract structured findings.",
    instruction:
      "Rewrite in the voice of a careful close reading: extract the structured finding and supporting evidence.",
    category: "research",
  },
  {
    name: "synthesis",
    title: "Synthesis",
    description: "Compose synthesis notes that link claims across sources.",
    instruction:
      "Rewrite as a synthesis note that links the claim to related sources and surfaces tensions.",
    category: "writing",
  },
] as const;
