// GSD-126 P0 — E2E debug endpoint for OR managed-bucket parity.
//
// Preview-only (refuses to serve in production). Authenticated via the
// caller's Better Auth session cookie — operates on the SIGNED-IN user
// only. No HMAC path; the test harness drives it from a logged-in browser
// session.
//
// Operations:
//   GET                       → { hash, orUsageUsd, orLimitUsd, localSumUsd,
//                                 diffUsd, toleranceUsd, withinTolerance,
//                                 createdAt } | { hash: null }
//   POST { action: "reset" }            → DELETE OR key + DELETE local row.
//   POST { action: "patch-limit", limit } → PATCH OR bucket limit.
//
// Used by apps/km/e2e/or-bucket-parity.spec.ts and the GSD-126 E2E
// parity subagent. NEVER imported from app code.

import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { getSessionInfo } from "@/lib/auth";
import {
  getUserBucketUsage,
  patchUserBucket,
} from "@/lib/openrouter-provisioning";
import { openrouterUsage, userOpenrouterKeys } from "@episteme/db/schema";

export const runtime = "nodejs";

function previewGate(): Response | null {
  // Hard refusal in production. Preview, development, and unset (local) are OK.
  if (process.env.VERCEL_ENV === "production") {
    return Response.json(
      { error: "debug endpoint disabled in production" },
      { status: 404 },
    );
  }
  return null;
}

async function loadHashAndCreatedAt(
  userId: string,
): Promise<{ hash: string; createdAt: Date } | null> {
  const rows = await db
    .select({
      hash: userOpenrouterKeys.orKeyHash,
      createdAt: userOpenrouterKeys.createdAt,
    })
    .from(userOpenrouterKeys)
    .where(eq(userOpenrouterKeys.userId, userId))
    .limit(1);
  const row = rows[0];
  return row ? { hash: row.hash, createdAt: row.createdAt } : null;
}

async function localSumSince(userId: string, since: Date): Promise<number> {
  const rows = await db
    .select({ costUsd: openrouterUsage.costUsd })
    .from(openrouterUsage)
    .where(
      and(
        eq(openrouterUsage.userId, userId),
        gte(openrouterUsage.createdAt, since),
      ),
    );
  return rows.reduce((acc, r) => acc + Number(r.costUsd), 0);
}

export async function GET(req: Request): Promise<Response> {
  const blocked = previewGate();
  if (blocked) return blocked;

  const session = await getSessionInfo(req);
  if (!session || session.isAnonymous) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const row = await loadHashAndCreatedAt(session.userId);
  if (!row) {
    return Response.json({ hash: null });
  }

  const orResp = await getUserBucketUsage(row.hash);
  const localSum = await localSumSince(session.userId, row.createdAt);
  const diff = Math.abs(orResp.usageUsd - localSum);
  const tolerance = Math.max(0.001, orResp.usageUsd * 0.05);
  return Response.json({
    hash: row.hash,
    createdAt: row.createdAt.toISOString(),
    orUsageUsd: orResp.usageUsd,
    orLimitUsd: orResp.limitUsd,
    localSumUsd: localSum,
    diffUsd: diff,
    toleranceUsd: tolerance,
    withinTolerance: diff <= tolerance,
  });
}

async function deleteOrKey(hash: string): Promise<void> {
  const provKey = process.env.OPENROUTER_PROVISIONING_KEY;
  if (!provKey) {
    throw new Error("OPENROUTER_PROVISIONING_KEY is not set");
  }
  const resp = await fetch(`https://openrouter.ai/api/v1/keys/${hash}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${provKey}` },
  });
  // Tolerate 404 — key may already be gone if a prior reset half-completed.
  if (!resp.ok && resp.status !== 404) {
    const text = await resp.text().catch(() => "<unreadable>");
    throw new Error(
      `OR DELETE key failed: ${resp.status} ${text.slice(0, 200)}`,
    );
  }
}

export async function POST(req: Request): Promise<Response> {
  const blocked = previewGate();
  if (blocked) return blocked;

  const session = await getSessionInfo(req);
  if (!session || session.isAnonymous) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { action?: string; limit?: number } | null = null;
  try {
    body = (await req.json()) as { action?: string; limit?: number };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body?.action) {
    return Response.json({ error: "missing action" }, { status: 400 });
  }

  if (body.action === "reset") {
    const row = await loadHashAndCreatedAt(session.userId);
    if (row) {
      try {
        await deleteOrKey(row.hash);
      } catch (err) {
        console.warn("[or-bucket-debug] OR DELETE failed (continuing)", err);
      }
      await db
        .delete(userOpenrouterKeys)
        .where(eq(userOpenrouterKeys.userId, session.userId));
    }
    return Response.json({ ok: true, deleted: !!row });
  }

  if (body.action === "patch-limit") {
    if (typeof body.limit !== "number" || body.limit <= 0) {
      return Response.json({ error: "invalid limit" }, { status: 400 });
    }
    const row = await loadHashAndCreatedAt(session.userId);
    if (!row) {
      return Response.json({ error: "no bucket" }, { status: 404 });
    }
    await patchUserBucket(row.hash, { limit: body.limit });
    return Response.json({ ok: true, hash: row.hash, limit: body.limit });
  }

  return Response.json({ error: "unknown action" }, { status: 400 });
}
