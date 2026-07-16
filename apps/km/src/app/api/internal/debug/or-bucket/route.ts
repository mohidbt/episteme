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
  createUserBucket,
  getUserBucketUsage,
  patchUserBucket,
} from "@/lib/openrouter-provisioning";
import { insertUserBucketIfMissing } from "@/lib/user-bucket-store";
import { openrouterUsage, userOpenrouterKeys } from "@episteme/db/schema";

export const runtime = "nodejs";

export function previewGate(): Response | null {
  // Fail closed when deployment metadata is absent or misspelled. An explicit
  // opt-in exists for trusted local/self-hosted development only.
  const environment = process.env.VERCEL_ENV;
  const isProduction =
    environment === "production" || process.env.NODE_ENV === "production";
  const isLocal = !environment || environment === "local";
  const enabled =
    !isProduction &&
    (environment === "preview" ||
      environment === "development" ||
      (isLocal && process.env.ENABLE_OR_BUCKET_DEBUG === "1"));
  if (!enabled) {
    return Response.json(
      { error: "debug endpoint disabled" },
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

  if (body.action === "diagnostic") {
    // Surface the provisioning env state + attempt a real createUserBucket
    // call. Anything we discover lands in the response so the E2E subagent
    // can see WHY lazy-provisioning silently fell through to env fallback.
    const provKey = process.env.OPENROUTER_PROVISIONING_KEY;
    const result: Record<string, unknown> = {
      provisioningKeyPresent: !!provKey,
      provisioningKeyLen: provKey?.length ?? 0,
      vercelEnv: process.env.VERCEL_ENV ?? null,
      sharedLlmKeyPresent: !!process.env.EPISTEME_SHARED_LLM_KEY,
      openrouterApiKeyPresent: !!process.env.OPENROUTER_API_KEY,
    };
    try {
      const minted = await createUserBucket(session.userId);
      result.createOk = true;
      result.hashPreview = minted.hash.slice(0, 12) + "…";
      // Also insert + persist so the parity check has something to inspect.
      const inserted = await insertUserBucketIfMissing({
        userId: session.userId,
        runtimeKey: minted.key,
        hash: minted.hash,
      });
      result.inserted = inserted;
    } catch (err) {
      result.createOk = false;
      result.createError =
        err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
    return Response.json(result);
  }

  if (body.action === "probe-completion") {
    // GSD-136: capture the RAW OpenRouter /chat/completions response shape
    // (status, headers, body) when called with the signed-in user's
    // managed-bucket runtime key. Run this immediately after a PATCH to a
    // tiny limit to ground-truth the bucket-exhausted error shape, which
    // GSD-126 historically assumed was HTTP 402.
    const row = await loadHashAndCreatedAt(session.userId);
    if (!row) {
      return Response.json({ error: "no bucket" }, { status: 404 });
    }
    // Look up the runtime key for THIS user by reading from the resolver
    // (which fetches the encrypted row + decrypts it). We can't use
    // getOrApiKey here directly because it might fall through to BYOK if
    // present; instead we go through the bucket store directly.
    const { loadUserBucket } = await import("@/lib/user-bucket-store");
    const bucket = await loadUserBucket(session.userId);
    if (!bucket) {
      return Response.json({ error: "bucket row vanished" }, { status: 404 });
    }
    const resp = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bucket.runtimeKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-5.4-nano",
          messages: [{ role: "user", content: "say 'hi'" }],
        }),
      },
    );
    const bodyText = await resp.text().catch(() => "<unreadable>");
    const headerObj: Record<string, string> = {};
    resp.headers.forEach((v, k) => {
      headerObj[k] = v;
    });
    return Response.json({
      status: resp.status,
      statusText: resp.statusText,
      headers: headerObj,
      bodyText,
      hash: row.hash,
    });
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
