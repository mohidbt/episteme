import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { references_, libraries } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError, requireOwned } from "@/lib/crud";
import { deriveCitationKey, validateCslJson, type CslItem } from "@/lib/csl";
import { detectFormat, parseCsl } from "@/lib/csl-import";
import { insertReferenceWithSuffixBump } from "@/lib/references";

export const runtime = "nodejs";

const MAX_IMPORT_BYTES = 256 * 1024;

type Conflict =
  | { citationKey: string; reason: "duplicate_doi" }
  | { citationKey: string; reason: "key_bumped"; final: string };

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "validation", { message: "multipart/form-data required" });
  }

  const libraryIdRaw = form.get("libraryId");
  const folderPathRaw = form.get("folderPath");
  const file = form.get("file");

  if (typeof libraryIdRaw !== "string") return jsonError(400, "validation", { message: "libraryId required" });
  const libraryId = Number.parseInt(libraryIdRaw, 10);
  if (!Number.isFinite(libraryId)) return jsonError(400, "validation", { message: "libraryId must be an integer" });
  const folderPath = typeof folderPathRaw === "string" ? folderPathRaw : "";
  if (!(file instanceof File)) return jsonError(400, "validation", { message: "file required" });
  if (file.size > MAX_IMPORT_BYTES) return jsonError(413, "file_too_large");

  const lib = await requireOwned<any>(libraries, libraryId, userId);
  if (!lib.ok) return jsonError(lib.status, lib.status === 404 ? "not_found" : "forbidden");

  const content = await file.text();
  const format = detectFormat(file.name, content);
  if (!format) return jsonError(400, "unknown_format");

  let items: CslItem[];
  try {
    items = parseCsl(content, format);
  } catch (err) {
    return jsonError(400, "parse_failed", { message: (err as Error).message });
  }

  // Validate every item up front; collect DOIs for dedup.
  const prepared: Array<{ csl: CslItem; citationKey: string; doi: string | null }> = [];
  for (let i = 0; i < items.length; i++) {
    let csl: CslItem;
    try {
      csl = validateCslJson(items[i]);
    } catch (err) {
      return jsonError(400, "parse_failed", { message: `item ${i}: ${(err as Error).message}` });
    }
    prepared.push({
      csl,
      citationKey: deriveCitationKey(csl),
      doi: typeof csl.DOI === "string" ? csl.DOI : null,
    });
  }

  // Fetch existing DOIs in this library for duplicate detection.
  const existing = await db
    .select({ doi: sql<string | null>`${references_.cslJson}->>'DOI'` })
    .from(references_)
    .where(and(eq(references_.libraryId, libraryId), eq(references_.userId, userId)));
  const existingDois = new Set(existing.map((r) => r.doi).filter((d): d is string => !!d));

  const conflicts: Conflict[] = [];
  let imported = 0;
  let skipped = 0;

  for (const p of prepared) {
    if (p.doi && existingDois.has(p.doi)) {
      conflicts.push({ citationKey: p.citationKey, reason: "duplicate_doi" });
      skipped++;
      continue;
    }

    const result = await insertReferenceWithSuffixBump({
      libraryId,
      folderPath,
      citationKey: p.citationKey,
      cslJson: p.csl,
      userId,
    });
    imported++;
    if (p.doi) existingDois.add(p.doi);
    if (result.bumped) {
      conflicts.push({ citationKey: p.citationKey, reason: "key_bumped", final: result.finalKey });
    }
  }

  return Response.json({ imported, skipped, conflicts }, { status: 201 });
}
