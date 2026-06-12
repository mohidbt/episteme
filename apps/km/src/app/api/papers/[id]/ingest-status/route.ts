import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { papers } from "@episteme/db/schema";
import {
  getAuthedUserId,
  MissingInternalSecretError,
} from "@/lib/internal-auth";
import { jsonError } from "@/lib/crud";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GSD-96 R1: lightweight ingest-status probe for the chat composer poll loop
 * (2s) and (per GSD-99) the drive-sidebar status dot, drive-page badge,
 * citation card "analyzing" hover.
 *
 * Dual-auth (cookie + HMAC) so the agent service can call this directly
 * during ingest pipelines without re-routing through a user cookie.
 *
 * Returns 404 instead of 403 on cross-user reads to avoid leaking existence.
 */
export async function GET(req: Request, { params }: Ctx) {
  let authed;
  try {
    authed = await getAuthedUserId(req);
  } catch (e) {
    if (e instanceof MissingInternalSecretError)
      return jsonError(500, "internal auth misconfigured");
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const { id } = await params;

  const [row] = await db
    .select({
      userId: papers.userId,
      chunksReadyAt: papers.chunksReadyAt,
      chandraStatus: papers.chandraStatus,
    })
    .from(papers)
    .where(eq(papers.id, id))
    .limit(1);

  if (!row || row.userId !== authed.userId) return jsonError(404, "not_found");

  return Response.json({
    chunksReadyAt: row.chunksReadyAt ? row.chunksReadyAt.toISOString() : null,
    chandraStatus: row.chandraStatus,
  });
}
