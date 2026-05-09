import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { papersets } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { getDecryptedApiKey, getDecryptedChandraKey } from "@episteme/auth/byok";
import { signRequest } from "@/lib/agents/sign-request";
import { jsonError, requireOwned } from "@/lib/crud";
import { OPENROUTER_KEY_MISSING } from "@/lib/openrouter-errors";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type PapersetRow = typeof papersets.$inferSelect;
type RowRef = { paper_id: string };
type ColumnSpec = { name: string; description: string };
type RunningCell = { row: number; col: string };

const Cell = z.object({
  row_idx: z.number().int().nonnegative(),
  col_name: z.string().min(1),
});
const Body = z.object({ cells: z.array(Cell).min(1) });

function misconfiguredResponse(): Response {
  return jsonError(500, "internal auth misconfigured");
}

function sseError(code: string, message: string): Response {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(
        new TextEncoder().encode(`event: error\ndata: ${JSON.stringify({ code, message })}\n\n`),
      );
      c.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

function tapStream(
  upstream: ReadableStream<Uint8Array>,
  onClose: () => Promise<void> | void,
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        await onClose();
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    async cancel() {
      await onClose();
      await reader.cancel();
    },
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const rawBody = await req.text();
  let authed;
  try {
    authed = await getAuthedUserId(req, rawBody);
  } catch (e) {
    if (e instanceof MissingInternalSecretError) return misconfiguredResponse();
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const { id } = await params;

  const owned = await requireOwned<PapersetRow>(papersets, id, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  let parsedBody;
  try {
    parsedBody = Body.safeParse(JSON.parse(rawBody));
  } catch {
    return jsonError(400, "validation");
  }
  if (!parsedBody.success) return jsonError(400, "validation", { issues: parsedBody.error.issues });

  const refs = owned.row.rowRefs as RowRef[];
  const colNames = new Set((owned.row.columns as ColumnSpec[]).map((c) => c.name));
  for (const c of parsedBody.data.cells) {
    if (c.row_idx >= refs.length) return jsonError(400, "row_oob");
    if (!colNames.has(c.col_name)) return jsonError(400, "unknown_col");
  }

  if ((owned.row.runningCells as RunningCell[]).length > 0) {
    return jsonError(409, "already_running");
  }

  let llmKey: string;
  try {
    llmKey = await getDecryptedApiKey(userId);
  } catch {
    return jsonError(400, OPENROUTER_KEY_MISSING);
  }

  const newRunning: RunningCell[] = parsedBody.data.cells.map((c) => ({
    row: c.row_idx,
    col: c.col_name,
  }));
  await db.update(papersets).set({ runningCells: newRunning }).where(eq(papersets.id, id));

  const clearRunning = async () => {
    await db
      .update(papersets)
      .set({ runningCells: [], updatedAt: new Date() })
      .where(eq(papersets.id, id));
  };

  const upstreamPath = "/agents/km/extract";
  const upstreamBody = JSON.stringify({ paperset_id: id, cells: parsedBody.data.cells });
  const { headers } = signRequest({
    method: "POST",
    path: upstreamPath,
    body: upstreamBody,
    userId,
    llmKey,
    ocrKey: (await getDecryptedChandraKey(userId)) ?? "",
  });

  const agentsUrl = process.env.AGENTS_URL ?? "";
  if (!agentsUrl) {
    // Distinguish "deploy is misconfigured" (env unset) from "agents service
    // is down" — both used to surface as a generic upstream_unavailable.
    console.error(
      "papersets/enrich: AGENTS_URL is not set; cannot reach agents service",
    );
    await clearRunning();
    return sseError(
      "agents_url_missing",
      "AGENTS_URL is not configured for this deployment",
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${agentsUrl}${upstreamPath}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: upstreamBody,
    });
  } catch (err) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(
      `papersets/enrich: upstream fetch failed (AGENTS_URL=${agentsUrl}): ${reason}`,
    );
    await clearRunning();
    return sseError("upstream_unavailable", `agents service unreachable: ${reason}`);
  }

  if (upstream.status === 501) {
    await clearRunning();
    return sseError("not_implemented", "data-extract skill ships in Phase 1.4.x");
  }

  if (!upstream.ok || !upstream.body) {
    await clearRunning();
    return sseError("upstream_error", `upstream returned ${upstream.status}`);
  }

  const tapped = tapStream(upstream.body, clearRunning);
  return new Response(tapped, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}
