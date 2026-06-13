export type ToolInventoryEntry = {
  name: string;
  description: string;
  category: string;
  gateable: boolean;
  default_allowed: boolean;
  // GSD-103 — agent service publishes the per-tool default approval mode
  // ("auto" | "require") via /agents/km/tools. The UI uses this as the
  // visual default when the user has no explicit saved rule for the tool,
  // so what the user sees matches what `_build_interrupt_on` applies on the
  // server. Optional for forward-compat with older payloads.
  default_approval?: "auto" | "require";
};

export function humanizeToolName(name: string): string {
  return name
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

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

export function humanizeCategory(slug: string): string {
  return humanizeToolName(slug);
}
