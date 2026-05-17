import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { references_, libraries, papers } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import {
  referenceCreateSchema,
  referenceCreateFromCslSchema,
  referenceCreateFromDoiSchema,
} from "@/lib/validators";
import { jsonError, requireOwned } from "@/lib/crud";
import { deriveCitationKey, validateCslJson, type CslItem } from "@/lib/csl";
import { fetchCrossRef } from "@/lib/crossref";
import { isUniqueViolation, suggestNextCitationKey } from "@/lib/references";
import { autoConnectReference, extractRefSignals } from "@/lib/citations/match-ref-to-papers";

export async function GET(req: Request) {
  // Dual-auth: cookie session OR HMAC (for agent tools like list_references).
  let authed;
  try { authed = await getAuthedUserId(req); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return jsonError(500, "internal auth misconfigured");
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const url = new URL(req.url);
  const libraryIdStr = url.searchParams.get("libraryId");
  let libraryId: number;
  if (libraryIdStr) {
    libraryId = Number(libraryIdStr);
    if (!Number.isFinite(libraryId)) return jsonError(400, "validation");
  } else if (authed.viaHmac) {
    // HMAC-authed agent tool calls (e.g. list_references) may omit libraryId;
    // resolve user's default library on the server.
    const rows = await db
      .select({ id: libraries.id })
      .from(libraries)
      .where(eq(libraries.userId, userId))
      .orderBy(asc(libraries.id))
      .limit(1);
    const defaultId = rows[0]?.id;
    if (defaultId == null) return jsonError(400, "no_library", { message: "user has no library" });
    libraryId = defaultId;
  } else {
    return jsonError(400, "validation", { message: "libraryId required" });
  }
  const folderPath = url.searchParams.get("folderPath");
  const q = url.searchParams.get("q");
  const limitRaw = url.searchParams.get("limit");
  const offsetRaw = url.searchParams.get("offset");
  let limit = 20;
  if (limitRaw !== null) {
    const n = Number(limitRaw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
      return jsonError(400, "validation", { message: "limit must be integer >= 1" });
    }
    limit = Math.min(n, 100);
  }
  let offset = 0;
  if (offsetRaw !== null) {
    const n = Number(offsetRaw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      return jsonError(400, "validation", { message: "offset must be integer >= 0" });
    }
    offset = n;
  }
  const conds = [eq(references_.userId, userId), eq(references_.libraryId, libraryId)];
  if (folderPath !== null) conds.push(eq(references_.folderPath, folderPath));
  if (q) {
    const pattern = `%${q}%`;
    const qCond = or(
      ilike(references_.citationKey, pattern),
      sql`${references_.cslJson}->>'title' ILIKE ${pattern}`,
    );
    if (qCond) conds.push(qCond);
  }
  const rows = await db
    .select()
    .from(references_)
    .where(and(...conds))
    .orderBy(asc(references_.createdAt))
    .limit(limit)
    .offset(offset);
  return Response.json(rows);
}

type InsertValues = {
  libraryId: number;
  folderPath: string;
  folderId?: string | null;
  citationKey: string;
  cslJson: unknown;
  paperId?: string | null;
  userId: string;
};

async function insertReference(values: InsertValues) {
  try {
    const [row] = await db.insert(references_).values(values).returning();
    return { ok: true as const, row };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return {
        ok: false as const,
        conflict: { error: "citation_key_conflict", suggestion: suggestNextCitationKey(values.citationKey) },
      };
    }
    throw err;
  }
}

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const body = await req.json().catch(() => null);

  const hasDoi = typeof (body as { doi?: unknown })?.doi === "string";
  const hasCslNoKey =
    !hasDoi &&
    (body as { cslJson?: unknown })?.cslJson != null &&
    typeof (body as { citationKey?: unknown })?.citationKey !== "string";

  let libraryId: number;
  let folderPath: string;
  let citationKey: string;
  let cslJson: CslItem;
  let paperId: string | null | undefined;

  if (hasDoi) {
    const parsed = referenceCreateFromDoiSchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });
    const fetched = await fetchCrossRef(parsed.data.doi);
    if (!fetched) return jsonError(404, "doi_not_found", { doi: parsed.data.doi });
    try {
      cslJson = validateCslJson(fetched);
    } catch (err) {
      return jsonError(400, "invalid_csl", { message: (err as Error).message });
    }
    libraryId = parsed.data.libraryId;
    folderPath = parsed.data.folderPath;
    citationKey = parsed.data.citationKey ?? deriveCitationKey(cslJson);
    paperId = parsed.data.paperId ?? null;
  } else if (hasCslNoKey) {
    const parsed = referenceCreateFromCslSchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });
    try {
      cslJson = validateCslJson(parsed.data.cslJson);
    } catch (err) {
      return jsonError(400, "invalid_csl", { message: (err as Error).message });
    }
    libraryId = parsed.data.libraryId;
    folderPath = parsed.data.folderPath;
    citationKey = parsed.data.citationKey ?? deriveCitationKey(cslJson);
    paperId = parsed.data.paperId ?? null;
  } else {
    const parsed = referenceCreateSchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });
    libraryId = parsed.data.libraryId;
    folderPath = parsed.data.folderPath;
    citationKey = parsed.data.citationKey;
    cslJson = parsed.data.cslJson as CslItem;
    paperId = parsed.data.paperId ?? null;
  }

  const lib = await requireOwned<any>(libraries, libraryId, userId);
  if (!lib.ok) return jsonError(lib.status, lib.status === 404 ? "not_found" : "forbidden");

  // BG7: when a source paper is provided, the reference inherits its folder
  // location. The client previously sent paper.folderPath but never
  // paper.folderId — and the drive UI filters by folderId — so refs created
  // via "Add as reference" always landed at the root.
  let folderId: string | null | undefined;
  if (paperId) {
    const paper = await requireOwned<any>(papers, paperId, userId);
    if (!paper.ok) return jsonError(paper.status, paper.status === 404 ? "not_found" : "forbidden");
    folderId = paper.row.folderId ?? null;
    folderPath = paper.row.folderPath ?? folderPath;
  }

  const result = await insertReference({ libraryId, folderPath, folderId, citationKey, cslJson, paperId, userId });
  if (!result.ok) return Response.json(result.conflict, { status: 409 });
  await autoConnectReference(result.row.id, userId, extractRefSignals(cslJson));
  return Response.json(result.row, { status: 201 });
}
