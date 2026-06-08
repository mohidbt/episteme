export type ToolInventoryEntry = {
  name: string;
  description: string;
  category: string;
  gateable: boolean;
  default_allowed: boolean;
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
