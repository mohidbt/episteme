import { signRequest } from "@/lib/agents/sign-request";

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface AgentPdfRequestContext {
  userId: string;
  documentId?: number;
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

export async function extractPdfPages(
  filePath: string,
  context: AgentPdfRequestContext
): Promise<ExtractedPage[]> {
  const path = "/agents/pdf/text";
  const body = JSON.stringify({ file_path: filePath });
  const { headers } = signRequest({
    method: "POST",
    path,
    body,
    userId: context.userId,
    documentId: context.documentId,
    llmKey: context.llmKey ?? "",
  });

  const res = await fetch(`${process.env.AGENTS_URL}${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) {
    throw new Error(`[pdf-text] agents request failed: ${res.status}`);
  }

  const payload = await res.json();
  return toExtractedPages(payload);
}
