/**
 * Path alias for agent tools (services/agents/tools/library.py).
 * Mirrors the existing /api/library/references shape. Supports an optional
 * `q` query param to filter by title (ilike). Dual-auth: cookie OR HMAC.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@episteme/db";
import { libraryReferences } from "@episteme/db/schema";
import { and, desc, eq, ilike } from "drizzle-orm";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";

export async function GET(request: NextRequest) {
  let authed;
  try { authed = await getAuthedUserId(request); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) {
      return NextResponse.json({ error: "internal auth misconfigured" }, { status: 500 });
    }
    throw e;
  }
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authed.userId;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  const conds = [eq(libraryReferences.userId, userId)];
  if (q.length > 0) {
    conds.push(ilike(libraryReferences.title, `%${q}%`));
  }

  const refs = await db
    .select()
    .from(libraryReferences)
    .where(and(...conds))
    .orderBy(desc(libraryReferences.createdAt));

  return NextResponse.json(refs);
}
