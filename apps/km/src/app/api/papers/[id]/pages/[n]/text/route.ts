/**
 * GET /api/papers/:id/pages/:n/text — extract text for a single PDF page.
 *
 * Wired for the agent `get_page_text` tool. Dual-auth: cookie OR HMAC.
 */
import { NextRequest } from "next/server";
import { papers } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@episteme/auth/internal";
import { jsonError, requireOwned } from "@/lib/crud";
import { extractPdfPages } from "@/lib/ai/pdf-text";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; n: string }> };
type PaperRow = typeof papers.$inferSelect;

export async function GET(request: NextRequest, { params }: Ctx) {
  let authed;
  try { authed = await getAuthedUserId(request); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) {
      return jsonError(500, "internal auth misconfigured");
    }
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;

  const { id, n } = await params;
  const pageNum = parseInt(n, 10);
  if (isNaN(pageNum) || pageNum < 1) {
    return jsonError(400, "Invalid page");
  }

  const owned = await requireOwned<PaperRow>(papers, id, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");
  const paper = owned.row;
  if (!paper.storageUrl) return jsonError(404, "source_missing");

  let pages;
  try {
    pages = await extractPdfPages(paper.storageUrl, {
      userId,
      paperId: id,
      llmKey: request.headers.get("x-inhale-llm-key") ?? "",
    });
  } catch {
    return jsonError(404, "page text not extracted");
  }
  const match = pages.find((p) => p.pageNumber === pageNum);
  if (!match) return jsonError(404, "page not found");

  return Response.json({ pageNumber: match.pageNumber, text: match.text });
}
