import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { references_, libraries } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import {
  referenceCreateSchema,
  referenceCreateFromCslSchema,
  referenceCreateFromDoiSchema,
} from "@/lib/validators";
import { jsonError, requireOwned } from "@/lib/crud";
import { deriveCitationKey, validateCslJson, type CslItem } from "@/lib/csl";
import { fetchCrossRef } from "@/lib/crossref";
import { isUniqueViolation, suggestNextCitationKey } from "@/lib/references";

export async function GET(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const url = new URL(req.url);
  const libraryIdStr = url.searchParams.get("libraryId");
  if (!libraryIdStr) return jsonError(400, "validation", { message: "libraryId required" });
  const libraryId = Number(libraryIdStr);
  if (!Number.isFinite(libraryId)) return jsonError(400, "validation");
  const folderPath = url.searchParams.get("folderPath");
  const q = url.searchParams.get("q");
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
  const rows = await db.select().from(references_).where(and(...conds)).orderBy(asc(references_.createdAt));
  return Response.json(rows);
}

type InsertValues = {
  libraryId: number;
  folderPath: string;
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

  const result = await insertReference({ libraryId, folderPath, citationKey, cslJson, paperId, userId });
  if (!result.ok) return Response.json(result.conflict, { status: 409 });
  return Response.json(result.row, { status: 201 });
}
