export type Author = { name: string; authorId?: string };

/** Convert a comma-separated authors string to the jsonb Author[] shape. */
export function authorStringToJson(str: string | null | undefined): Author[] | null {
  if (!str || str.trim() === "") return null;
  const parts = str.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  return parts.map((name) => ({ name }));
}
