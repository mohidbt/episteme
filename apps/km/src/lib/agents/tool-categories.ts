/**
 * Helpers for rendering the live agent tool inventory in
 * PermissionToggles.tsx — humanize names, override descriptions for the
 * most-shown tools, group by category.
 */

export type ToolInventoryEntry = {
  name: string;
  description: string;
  category: string;
  gateable: boolean;
  default_allowed: boolean;
};

/**
 * snake_case_name → "Snake Case Name". Plain title-case with underscores
 * replaced by spaces. No special-case acronyms.
 */
export function humanizeToolName(name: string): string {
  return name
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Hand-written descriptions for the most-shown tools. The agent service's
 * raw BaseTool.description is written for the LLM (terse + machine-flavoured);
 * these overrides are written for the settings UI (user-friendly, no brand
 * names like "Tavily" that leak per RG1 #66).
 */
export const TOOL_DESCRIPTION_OVERRIDES: Record<string, string> = {
  web_search:
    "Allow the agent to fall back to web search when internal library and specialized paper-search tools fail.",
  create_note:
    "Create a new note in your drive. Disable to prevent the agent from writing notes on your behalf.",
  read_paper:
    "Read PDF papers from your library, including full-text and per-page retrieval for citations.",
  agentic_search_papers:
    "Search across the academic web (Semantic Scholar / OpenAlex) for new papers to add to your library.",
  make_public:
    "Publish notes to a public URL. Disable to keep all notes private until you publish them manually.",
};

/**
 * Group tools by category. Categories are sorted alphabetically; tools
 * within each category preserve the input order so the UI is stable across
 * fetches.
 */
export function groupByCategory(
  tools: ToolInventoryEntry[],
): Array<{ category: string; tools: ToolInventoryEntry[] }> {
  const buckets = new Map<string, ToolInventoryEntry[]>();
  for (const t of tools) {
    const list = buckets.get(t.category) ?? [];
    list.push(t);
    buckets.set(t.category, list);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, list]) => ({ category, tools: list }));
}

/**
 * Humanize a category slug. "paper_search" → "Paper Search".
 */
export function humanizeCategory(slug: string): string {
  return humanizeToolName(slug);
}
