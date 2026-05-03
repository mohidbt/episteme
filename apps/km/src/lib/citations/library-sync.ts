import type { InferSelectModel } from "drizzle-orm";
import type { documentReferences } from "@episteme/db/schema";

type DocumentReference = InferSelectModel<typeof documentReferences>;
type Author = { name: string; authorId?: string };

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

function firstNonBlank(...values: (string | null | undefined)[]): string {
  for (const v of values) {
    if (v && v.trim() !== "") return v;
  }
  return "";
}

export function buildLibraryReference(
  userId: string,
  ref: DocumentReference,
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
