import { and, eq } from "drizzle-orm";
import { getSessionInfo } from "@/lib/auth";
import { db } from "@/lib/db";
import { papers } from "@episteme/db/schema";
import { storage, paperSourceKey } from "@/lib/storage";

export const runtime = "nodejs";
// Self-maintenance route; capped at the per-call BATCH below so a large
// library can be processed across multiple invocations rather than timing
// out mid-loop.
export const maxDuration = 60;

const BATCH = 200;

// One-shot, idempotent, self-scoped backfill for the current user's
// `papers.size_bytes`. Selects rows where `size_bytes = 0`, HEADs the R2
// object at `paperSourceKey(id)` via presigned URL, writes Content-Length back.
//
// Why a route (not the offline script): the offline script needs
// OWNER_DATABASE_URL + S3 creds locally. The KM server already has both wired
// for normal upload/finalize traffic, so the same identity-scoped write works
// without exporting prod credentials.
export async function POST(req: Request) {
  const session = await getSessionInfo(req);
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = session.userId;

  const rows = await db
    .select({ id: papers.id })
    .from(papers)
    .where(and(eq(papers.userId, userId), eq(papers.sizeBytes, 0)))
    .limit(BATCH);

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  const skippedReasons: Record<string, number> = {};
  const bump = (reason: string) => {
    skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
  };

  // Serial loop: each HEAD is cheap and the per-user candidate set is small.
  // Avoids fanning out parallel R2 HEADs from a Vercel function.
  for (const row of rows) {
    scanned++;
    try {
      const url = await storage.getPresignedHead(paperSourceKey(row.id), 60);
      const headRes = await fetch(url, { method: "HEAD" });
      if (!headRes.ok) {
        skipped++;
        bump(`head_${headRes.status}`);
        continue;
      }
      const lenStr = headRes.headers.get("content-length");
      const len = lenStr ? Number(lenStr) : NaN;
      if (!Number.isFinite(len) || len <= 0) {
        skipped++;
        bump("bad_content_length");
        continue;
      }
      // Race guard: only update if still 0 — never clobber a value already
      // written by finalize.
      const res = await db
        .update(papers)
        .set({ sizeBytes: len })
        .where(
          and(
            eq(papers.id, row.id),
            eq(papers.userId, userId),
            eq(papers.sizeBytes, 0),
          ),
        )
        .returning({ id: papers.id });
      if (res.length > 0) updated++;
      else {
        skipped++;
        bump("raced_or_no_match");
      }
    } catch (err) {
      skipped++;
      bump("exception");
      console.warn(
        `[backfill-size] user=${userId} paper=${row.id}`,
        (err as Error).message ?? err,
      );
    }
  }

  return Response.json({ scanned, updated, skipped, skippedReasons });
}
