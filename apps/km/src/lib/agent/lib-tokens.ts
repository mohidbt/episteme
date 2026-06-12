// GSD-96 Round 2 — library-handle token grammar.
//
// Grammar (locked, plan section 3.1):
//   [lib: kind=<paper|note|reference|paperset> id=<uuid> title="<display>"]
//
// Distinct from `[Attached file: ...]` so the agent middleware can split lib
// tokens off BEFORE the asset-bytes pipeline runs. Lib tokens are ID
// handles, never bytes — agent uses its own tools (read_paper, read_note,
// lookup_reference, list_paperset_papers) to inspect.

export type LibraryKind = "paper" | "note" | "reference" | "paperset";

export interface LibraryHandle {
  kind: LibraryKind;
  id: string;
  title: string;
}

const KINDS: ReadonlySet<string> = new Set([
  "paper",
  "note",
  "reference",
  "paperset",
]);

// Strict shape: kind (alpha), id (uuid-ish hex+hyphen), title (quoted).
const TOKEN_RE =
  /\[lib:\s+kind=(?<kind>[a-z]+)\s+id=(?<id>[A-Za-z0-9-]+)\s+title="(?<title>[^"]*)"\]/g;

export function formatLibraryHandles(handles: LibraryHandle[]): string {
  if (handles.length === 0) return "";
  return handles
    .map((h) => {
      const safeTitle = h.title.replace(/"/g, "");
      return `[lib: kind=${h.kind} id=${h.id} title="${safeTitle}"]`;
    })
    .join(" ");
}

export interface ParseResult {
  cleaned: string;
  handles: LibraryHandle[];
}

export function parseLibraryTokens(text: string): ParseResult {
  const handles: LibraryHandle[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const kind = m.groups?.kind;
    const id = m.groups?.id;
    const title = m.groups?.title;
    if (!kind || !id || title === undefined) continue;
    if (!KINDS.has(kind)) continue;
    handles.push({ kind: kind as LibraryKind, id, title });
  }
  const cleaned = text
    .replace(TOKEN_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { cleaned, handles };
}
