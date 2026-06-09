export interface CslItem {
  id: string;
  type: string;
  title?: string;
  author?: Array<{ family?: string; given?: string; literal?: string }>;
  issued?: { "date-parts"?: number[][] };
  DOI?: string;
  URL?: string;
  "container-title"?: string;
  abstract?: string;
  [key: string]: unknown;
}

export function validateCslJson(obj: unknown): CslItem {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new Error("CSL item must be a non-null object");
  }
  const record = obj as Record<string, unknown>;
  if (!("id" in record)) throw new Error("CSL item missing required field: id");
  if (typeof record.id !== "string") throw new Error("CSL item field id must be a string");
  if (!("type" in record)) throw new Error("CSL item missing required field: type");
  if (typeof record.type !== "string") throw new Error("CSL item field type must be a string");
  return record as unknown as CslItem;
}

const STOP_WORDS = new Set([
  "a", "an", "the", "on", "of", "in", "to", "for",
  "and", "or", "with", "from", "at", "by", "is",
]);

function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function deriveCitationKey(csl: CslItem): string {
  // Author part
  const firstAuthor = csl.author?.[0];
  const rawName = firstAuthor?.family ?? firstAuthor?.literal ?? "unknown";
  const authorPart = normalise(rawName) || "unknown";

  // Year part
  const rawYear = csl.issued?.["date-parts"]?.[0]?.[0];
  const yearPart =
    typeof rawYear === "number" && isFinite(rawYear) ? String(rawYear) : "nd";

  // Title part
  let titlePart = "untitled";
  if (csl.title) {
    const words = csl.title.split(/\s+/);
    const substantial = words.find((w) => !STOP_WORDS.has(w.toLowerCase()));
    if (substantial) {
      titlePart = normalise(substantial) || "untitled";
    }
  }

  return authorPart + yearPart + titlePart;
}

function authorName(a: { family?: string; given?: string; literal?: string }): string {
  return a.family ?? a.literal ?? "";
}

export function denormaliseForList(
  csl: CslItem,
): { title: string; authorsText: string; year: number | null; doi: string | null } {
  const title = csl.title ?? "";

  const authors = csl.author ?? [];
  let authorsText: string;
  if (authors.length === 0) {
    authorsText = "";
  } else if (authors.length === 1) {
    authorsText = authorName(authors[0]);
  } else if (authors.length === 2) {
    authorsText = `${authorName(authors[0])} & ${authorName(authors[1])}`;
  } else {
    authorsText = `${authorName(authors[0])} et al.`;
  }

  const rawYear = csl.issued?.["date-parts"]?.[0]?.[0];
  const year = typeof rawYear === "number" && isFinite(rawYear) ? rawYear : null;

  const doi = csl.DOI ?? null;

  return { title, authorsText, year, doi };
}

/**
 * Convert AI-fill suggestions (denormalised field names) back to a CSL JSON
 * patch that can be merged with the existing cslJson before PATCHing.
 *
 * The AI fill endpoint returns fields like { title, authors, year, doi, venue }
 * but the references PATCH endpoint only accepts { cslJson } — so we must
 * map these denormalised names back to their CSL equivalents.
 */
export function suggestionsToCslPatch(
  suggestions: Record<string, unknown>,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };

  if ("title" in suggestions && suggestions.title != null) {
    merged.title = String(suggestions.title);
  }
  if ("authors" in suggestions && suggestions.authors != null) {
    const raw = suggestions.authors;
    if (Array.isArray(raw)) {
      merged.author = raw.map((a) =>
        typeof a === "string" ? { literal: a } : a,
      );
    } else {
      merged.author = [{ literal: String(raw) }];
    }
  }
  if ("year" in suggestions && suggestions.year != null) {
    const y =
      typeof suggestions.year === "number"
        ? suggestions.year
        : parseInt(String(suggestions.year), 10);
    if (Number.isFinite(y)) {
      merged.issued = { "date-parts": [[y]] };
    }
  }
  if ("doi" in suggestions && suggestions.doi != null) {
    merged.DOI = String(suggestions.doi);
  }
  if ("venue" in suggestions && suggestions.venue != null) {
    merged["container-title"] = String(suggestions.venue);
  }
  // GSD-42 — Abstract was previously dropped from suggestions, so the
  // references "Fill all missing" path couldn't backfill missing abstracts
  // even when the LLM returned one.
  if ("abstract" in suggestions && suggestions.abstract != null) {
    merged.abstract = String(suggestions.abstract);
  }

  return merged;
}
