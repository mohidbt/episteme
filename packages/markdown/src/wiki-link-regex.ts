export interface Link {
  kind: "note" | "reference" | "paper";
  raw: string;
  alias: string | null;
}

// `(?<!\\)` rejects escaped `\[[`. Inner disallows `]`, `[`, and `|` so nested brackets don't match.
const LINK_RE = /(?<!\\)\[\[([^\]\[|]+)(?:\|([^\]\[]+))?\]\]/g;

// Tag must be preceded by start-of-string or whitespace (so `issue#123` and `\#x` fail),
// first char must be a letter (digits-only tags like `#123` rejected).
const TAG_RE = /(?:^|\s)#([a-z][a-z0-9_-]*)/gi;

const CODE_FENCE_RE = /```[\s\S]*?```|`[^`\n]+`/g;
const HEADING_RE = /^#{1,6}\s+.*$/gm;

function stripCodeAndHeadings(md: string): string {
  return md.replace(CODE_FENCE_RE, "").replace(HEADING_RE, "");
}

function classify(inner: string): { kind: Link["kind"]; raw: string } {
  const trimmed = inner.trim();
  // Newer short-form prefixes take precedence; they sit alongside the legacy
  // `@` / `pdf:` prefixes for backward compat with existing notes.
  if (/^p:/i.test(trimmed)) return { kind: "paper", raw: trimmed.replace(/^p:/i, "").trim() };
  if (/^r:/i.test(trimmed)) return { kind: "reference", raw: trimmed.replace(/^r:/i, "").trim() };
  if (trimmed.startsWith("@")) return { kind: "reference", raw: trimmed.slice(1).trim() };
  if (/^pdf:/i.test(trimmed)) return { kind: "paper", raw: trimmed.replace(/^pdf:/i, "").trim() };
  return { kind: "note", raw: trimmed };
}

export function extractLinks(md: string): Link[] {
  const stripped = stripCodeAndHeadings(md);
  const seen = new Set<string>();
  const out: Link[] = [];
  for (const m of stripped.matchAll(LINK_RE)) {
    const inner = m[1]!;
    const alias = m[2]?.trim() ?? null;
    const { kind, raw } = classify(inner);
    if (raw.length === 0) continue;
    const key = `${kind}::${raw}::${alias ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, raw, alias });
  }
  return out;
}

export function extractTags(md: string): string[] {
  const stripped = stripCodeAndHeadings(md);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of stripped.matchAll(TAG_RE)) {
    const tag = m[1]!.toLowerCase();
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}
