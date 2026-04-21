import matter from "gray-matter";

export interface ParsedMarkdown {
  data: Record<string, unknown>;
  content: string;
}

/**
 * Thin wrapper over gray-matter so the rest of the codebase doesn't couple to
 * its package shape. Missing/invalid frontmatter yields `{ data: {}, content: raw }`.
 * The `content` returned is the body with the frontmatter block stripped.
 */
export function parseFrontmatter(raw: string): ParsedMarkdown {
  try {
    const parsed = matter(raw);
    return {
      data: (parsed.data ?? {}) as Record<string, unknown>,
      content: parsed.content,
    };
  } catch {
    // gray-matter throws on malformed YAML — treat as "no frontmatter".
    return { data: {}, content: raw };
  }
}
