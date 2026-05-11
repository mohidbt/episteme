import { and, eq, lt, sql } from "drizzle-orm";
import { MissingInternalSecretError, verifyInternalAuth } from "@episteme/auth/internal";
import { db } from "@/lib/db";
import { user, session } from "@episteme/db/schema";
import { cleanupUserR2 } from "@/lib/cleanup-anonymous-r2";

export const runtime = "nodejs";

const DEFAULT_MAX_AGE_DAYS = 7;
const MIN_MAX_AGE_DAYS = 1;
const DEFAULT_LIMIT = 200;

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` AND
 * `x-vercel-cron: 1` (the latter set by Vercel's infra and stripped from
 * inbound external requests). Require both for destructive GETs so a
 * leaked CRON_SECRET alone can't be replayed via curl to thrash R2.
 * Manual operators should call POST (with bearer) and pass `dryRun: true`
 * first.
 */
function checkVercelCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) return false;
  // GET = Vercel Cron path — require the infra header too.
  if (request.method === "GET") {
    return request.headers.get("x-vercel-cron") !== null;
  }
  // POST = internal operator path — bearer alone is enough.
  return true;
}

interface Body {
  maxAgeDays?: number;
  limit?: number;
  dryRun?: boolean;
}

/**
 * Sweep abandoned anonymous user sessions. A guest who never signs up leaves
 * their seeded + agent-fetched papers in R2 forever (no link → no
 * onAnonymousLink → no cleanup). This route finds anon users older than
 * `maxAgeDays` whose latest session expired already, deletes their R2
 * objects, then deletes the user row (cascade wipes DB).
 *
 * Auth: same internal-HMAC scheme as /api/internal/schema. Intended caller
 * is a Vercel Cron entry (configure in vercel.ts / vercel.json with
 * `schedule: "0 4 * * *"` once we add the cron config file).
 *
 * Body: { maxAgeDays?: number = 7, limit?: number = 200, dryRun?: boolean }
 * Response: { ok, processed, failed, dryRun, candidates }
 */
async function handle(request: Request, rawBody: string): Promise<Response> {
  if (!checkVercelCron(request)) {
    try {
      const auth = await verifyInternalAuth(request, rawBody);
      if (!auth.ok) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
    } catch (error) {
      if (error instanceof MissingInternalSecretError) {
        return Response.json({ error: "internal auth misconfigured" }, { status: 500 });
      }
      throw error;
    }
  }

  let body: Body = {};
  if (rawBody) {
    try {
      body = JSON.parse(rawBody) as Body;
    } catch {
      return Response.json({ error: "invalid json" }, { status: 400 });
    }
  }

  const maxAgeDays = Math.max(body.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS, MIN_MAX_AGE_DAYS);
  const limit = Math.min(body.limit ?? DEFAULT_LIMIT, 1000);
  const dryRun = body.dryRun === true;

  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

  // Anon users older than cutoff whose newest session (if any) is already
  // expired. The `NOT EXISTS` form catches anons with zero session rows too.
  const candidates = await db
    .select({ id: user.id, createdAt: user.createdAt })
    .from(user)
    .where(
      and(
        eq(user.isAnonymous, true),
        lt(user.createdAt, cutoff),
        sql`NOT EXISTS (
          SELECT 1 FROM ${session}
          WHERE ${session.userId} = ${user.id}
            AND ${session.expiresAt} > NOW()
        )`,
      ),
    )
    .limit(limit);

  if (dryRun) {
    return Response.json({
      ok: true,
      dryRun: true,
      processed: 0,
      failed: 0,
      candidates: candidates.map((c) => c.id),
    });
  }

  let processed = 0;
  let failed = 0;
  for (const c of candidates) {
    try {
      await cleanupUserR2(c.id);
      await db.delete(user).where(eq(user.id, c.id));
      processed++;
    } catch {
      failed++;
    }
  }

  return Response.json({
    ok: true,
    dryRun: false,
    processed,
    failed,
    candidates: candidates.map((c) => c.id),
  });
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  return handle(request, rawBody);
}

// Vercel Cron sends GET. Accept it with default body so the route can be
// scheduled without any vercel.ts plumbing for request bodies.
export async function GET(request: Request): Promise<Response> {
  return handle(request, "");
}
