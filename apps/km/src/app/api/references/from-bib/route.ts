import { db } from "@/lib/db";
import { references_, libraries } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError, requireOwned } from "@/lib/crud";
import { deriveCitationKey, type CslItem } from "@/lib/csl";
import { parseCsl } from "@/lib/csl-import";
import { isUniqueViolation } from "@/lib/references";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";

const MAX_BIB_BYTES = 5 * 1024 * 1024; // 5 MB

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
  const folderIdRaw = form.get("folderId");
  const file = form.get("file");

  if (typeof libraryIdRaw !== "string") return jsonError(400, "validation", { message: "libraryId required" });
  const libraryId = Number.parseInt(libraryIdRaw, 10);
  if (!Number.isFinite(libraryId)) return jsonError(400, "validation", { message: "libraryId must be an integer" });
  if (!(file instanceof File)) return jsonError(400, "validation", { message: "file required" });

  const ext = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
  if (ext !== "bib") {
    return jsonError(400, "unsupported_file_type", { message: "Only .bib (BibTeX) files are supported" });
  }

  if (file.size > MAX_BIB_BYTES) return jsonError(413, "file_too_large");

  const lib = await requireOwned<any>(libraries, libraryId, userId);
  if (!lib.ok) return jsonError(lib.status, lib.status === 404 ? "not_found" : "forbidden");

  const content = await file.text();
  let items: CslItem[];
  try {
    items = parseCsl(content, "bibtex");
  } catch (err) {
    return jsonError(400, "parse_failed", { message: (err as Error).message });
  }

  const folderPath = typeof folderPathRaw === "string" ? folderPathRaw : "";
  const folderId = typeof folderIdRaw === "string" ? folderIdRaw : null;

  // Load existing citation keys in this library to detect duplicates
  const existingRows = await db
    .select({ citationKey: references_.citationKey })
    .from(references_)
    .where(and(eq(references_.libraryId, libraryId), eq(references_.userId, userId)));
  const existingKeys = new Set(existingRows.map((r) => r.citationKey));

  let created = 0;
  let skipped = 0;
  const errors: { key: string; msg: string }[] = [];

  for (const csl of items) {
    const citationKey = deriveCitationKey(csl);
    if (existingKeys.has(citationKey)) {
      skipped++;
      continue;
    }

    try {
      await db.insert(references_).values({
        libraryId,
        userId,
        folderPath,
        ...(folderId ? { folderId } : {}),
        citationKey,
        cslJson: csl,
      });
      existingKeys.add(citationKey);
      created++;
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Race condition: another request inserted same key between our check and insert
        skipped++;
      } else {
        errors.push({ key: citationKey, msg: (err as Error).message });
      }
    }
  }

  return Response.json({ created, skipped, errors }, { status: 201 });
}
