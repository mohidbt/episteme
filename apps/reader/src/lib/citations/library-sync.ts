import type { DocumentReference } from "@/components/reader/citation-card";
import type { Author } from "@/lib/citations/author-utils";

export interface LibraryReferenceInput {
  userId: string;
  title: string;
  authors: Author[] | null;
  year: string | null;
  doi: string | null;
  url: string | null;
  semanticScholarId: string | null;
  abstract: string | null;
  venue: string | null;
  citationCount: number | null;
}

/**
 * Build a library_references insert payload from a document_reference row.
 * Title falls back: title → rawText → markerText. Empty/whitespace-only values
 * are treated as absent so a stray "" from a bad parse doesn't become the title.
 */
function firstNonBlank(...values: (string | null | undefined)[]): string {
  for (const v of values) {
    if (v && v.trim() !== "") return v;
  }
  // Schema guarantees markerText is non-null and non-empty; but if the caller
  // manages to pass all-blank, fall through to an empty string rather than crash.
  return "";
}

export function buildLibraryReference(
  userId: string,
  ref: DocumentReference
): LibraryReferenceInput {
  return {
    userId,
    title: firstNonBlank(ref.title, ref.rawText, ref.markerText),
    authors: ref.authors ?? null,
    year: ref.year ?? null,
    doi: ref.doi ?? null,
    url: ref.url ?? null,
    semanticScholarId: ref.semanticScholarId ?? null,
    abstract: ref.abstract ?? null,
    venue: ref.venue ?? null,
    citationCount: ref.citationCount ?? null,
  };
}
