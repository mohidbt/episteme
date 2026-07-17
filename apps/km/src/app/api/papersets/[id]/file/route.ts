import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { jsonError, requireOwned } from "@/lib/crud";
import { papersets } from "@episteme/db/schema";
import { attachmentContentDisposition } from "@/lib/filename";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type PapersetRow = typeof papersets.$inferSelect;

function misconfiguredResponse(): Response {
  return jsonError(500, "internal auth misconfigured");
}

function ensureCsvFilename(filename: string): string {
  const trimmed = filename.trim();
  return trimmed.toLowerCase().endsWith(".csv") ? trimmed : `${trimmed}.csv`;
}

export async function GET(req: Request, { params }: Ctx) {
  let authed;
  try {
    authed = await getAuthedUserId(req);
  } catch (e) {
    if (e instanceof MissingInternalSecretError) return misconfiguredResponse();
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");

  const { id } = await params;
  const owned = await requireOwned<PapersetRow>(papersets, id, authed.userId);
  if (!owned.ok) {
    return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");
  }

  return new Response(owned.row.content ?? "", {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": attachmentContentDisposition(
        ensureCsvFilename(owned.row.filename),
      ),
      "Cache-Control": "private, no-store",
    },
  });
}
