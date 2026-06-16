import { signRequest } from "@/lib/agents/sign-request";
import {
  reparseSanitizedRawText,
  sanitizeRefField,
  type ParsedReference,
} from "@/lib/citations/parser";
import type { AgentPdfRequestContext } from "@/lib/ai/pdf-text";

export interface MarkerRect {
  markerIndex: number;
  pageNumber: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface AnnotationExtractionResult {
  references: ParsedReference[];
  markers: MarkerRect[];
}

interface AgentReference {
  markerIndex: number;
  rawText: string;
  title: string | null;
  authors: string | null;
  year: string | null;
  doi: string | null;
  url: string | null;
}

interface AgentAnnotationResponse {
  references: AgentReference[];
  markers: MarkerRect[];
}

function toParsedReference(ref: AgentReference): ParsedReference {
  // Springer-Nature InDesign export corruption (".indd:" filename prefix + a
  // shower of U+FEFF zero-width no-break spaces) leaks through the agents
  // PDF annotation extractor on a per-reference basis: ref 1 may be clean
  // while ref 2 carries the prefix + BOMs in `rawText` and an empty `title`.
  // Apply the same sanitizer the text-regex path uses on every string field,
  // then — when the agent gave us no title — re-parse the cleaned rawText so
  // the title comes back instead of falling through to the corrupted rawText
  // in the UI.
  const cleanedRaw = sanitizeRefField(ref.rawText);
  const cleanedTitle = sanitizeRefField(ref.title);
  const cleanedAuthors = sanitizeRefField(ref.authors);
  const cleanedYear = sanitizeRefField(ref.year);
  const cleanedDoi = sanitizeRefField(ref.doi);
  const cleanedUrl = sanitizeRefField(ref.url);

  let title = cleanedTitle;
  let authors = cleanedAuthors;
  let year = cleanedYear;
  let doi = cleanedDoi;
  let url = cleanedUrl;

  if (!title && cleanedRaw) {
    const recovered = reparseSanitizedRawText(ref.markerIndex, cleanedRaw);
    title = recovered.title ?? title;
    authors = authors ?? recovered.authors;
    year = year ?? recovered.year;
    doi = doi ?? recovered.doi;
    url = url ?? recovered.url;
  }

  return {
    markerIndex: ref.markerIndex,
    rawText: cleanedRaw ?? "",
    title,
    authors,
    year,
    doi,
    url,
  };
}

function toAnnotationResult(payload: unknown): AnnotationExtractionResult {
  if (!payload || typeof payload !== "object") {
    throw new Error("[annotation-extractor] invalid response payload");
  }
  const response = payload as AgentAnnotationResponse;
  if (!Array.isArray(response.references) || !Array.isArray(response.markers)) {
    throw new Error("[annotation-extractor] invalid response payload");
  }
  return {
    references: response.references.map(toParsedReference),
    markers: response.markers.map((m) => ({
      markerIndex: m.markerIndex,
      pageNumber: m.pageNumber,
      x0: m.x0,
      y0: m.y0,
      x1: m.x1,
      y1: m.y1,
    })),
  };
}

export async function extractAnnotationMarkers(
  filePath: string,
  context: AgentPdfRequestContext,
): Promise<AnnotationExtractionResult> {
  const agentsUrl = process.env.AGENTS_URL;
  if (!agentsUrl) throw new Error("[annotation-extractor] AGENTS_URL missing");

  const path = "/agents/pdf/annotations";
  const body = JSON.stringify({ file_path: filePath });
  const { headers } = signRequest({
    method: "POST",
    path,
    body,
    userId: context.userId,
    paperId: context.paperId,
    llmKey: context.llmKey ?? "",
  });

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${agentsUrl}${path}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`[annotation-extractor] agents request failed: ${res.status}`);
    }

    return toAnnotationResult(await res.json());
  } finally {
    clearTimeout(t);
  }
}
