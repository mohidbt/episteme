import { signRequest } from "@/lib/agents/sign-request";
import type { ParsedReference } from "@/lib/citations/parser";
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
  return {
    markerIndex: ref.markerIndex,
    rawText: ref.rawText,
    title: ref.title ?? undefined,
    authors: ref.authors ?? undefined,
    year: ref.year ?? undefined,
    doi: ref.doi ?? undefined,
    url: ref.url ?? undefined,
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

  const res = await fetch(`${agentsUrl}${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) {
    throw new Error(`[annotation-extractor] agents request failed: ${res.status}`);
  }

  return toAnnotationResult(await res.json());
}
