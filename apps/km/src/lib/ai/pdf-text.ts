import { signRequest } from "@/lib/agents/sign-request";

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface AgentPdfRequestContext {
  userId: string;
  paperId?: string;
  llmKey?: string;
}

interface PdfTextResponse {
  pages: Array<{ pageNumber: number; text: string }>;
}

function toExtractedPages(payload: unknown): ExtractedPage[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as PdfTextResponse).pages)) {
    throw new Error("[pdf-text] invalid response payload");
  }
  return (payload as PdfTextResponse).pages.map((p) => ({
    pageNumber: p.pageNumber,
    text: p.text,
  }));
}

/**
 * Call the agents service /agents/pdf/text endpoint to extract per-page text.
 * `filePath` is whatever locator the agents service understands for this
 * paper (currently a local file path; in the post-A2 world this will be an
 * S3 key — the agents-side resolver is updated separately).
 */
export async function extractPdfPages(
  filePath: string,
  context: AgentPdfRequestContext,
): Promise<ExtractedPage[]> {
  const agentsUrl = process.env.AGENTS_URL;
  if (!agentsUrl) throw new Error("[pdf-text] AGENTS_URL missing");

  const path = "/agents/pdf/text";
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
      throw new Error(`[pdf-text] agents request failed: ${res.status}`);
    }

    const payload = await res.json();
    return toExtractedPages(payload);
  } finally {
    clearTimeout(t);
  }
}
