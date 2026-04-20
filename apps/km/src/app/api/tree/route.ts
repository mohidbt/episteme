import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { libraries, notes, papers, references_ } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/crud";

const AGENT_ITEMS = [
  { kind: "skills", label: "skills.md" },
  { kind: "memory", label: "memory.md" },
  { kind: "settings", label: "settings.json" },
] as const;

export async function GET(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const url = new URL(req.url);
  const libraryIdStr = url.searchParams.get("libraryId");
  if (!libraryIdStr) return jsonError(400, "validation", { message: "libraryId required" });
  const libraryId = Number(libraryIdStr);
  if (!Number.isFinite(libraryId)) return jsonError(400, "validation", { message: "libraryId must be a number" });

  const libRows = await db
    .select({ id: libraries.id, name: libraries.name })
    .from(libraries)
    .where(and(eq(libraries.id, libraryId), eq(libraries.userId, userId)))
    .limit(1);
  const lib = libRows[0];
  if (!lib) return jsonError(404, "not_found");

  const [papersRows, refsRowsRaw, notesRows] = await Promise.all([
    db
      .select({ id: papers.id, title: papers.title, folder_path: papers.folderPath })
      .from(papers)
      .where(and(eq(papers.libraryId, libraryId), eq(papers.userId, userId)))
      .orderBy(asc(papers.addedAt)),
    db
      .select({
        id: references_.id,
        citation_key: references_.citationKey,
        csl_json: references_.cslJson,
        folder_path: references_.folderPath,
      })
      .from(references_)
      .where(and(eq(references_.libraryId, libraryId), eq(references_.userId, userId)))
      .orderBy(asc(references_.createdAt)),
    db
      .select({ id: notes.id, title: notes.title, slug: notes.slug, folder_path: notes.folderPath })
      .from(notes)
      .where(and(eq(notes.libraryId, libraryId), eq(notes.userId, userId)))
      .orderBy(asc(notes.createdAt)),
  ]);

  const refsRows = refsRowsRaw.map((r) => {
    const csl = r.csl_json as { title?: string } | null;
    const title: string = csl?.title ?? r.citation_key;
    return {
      id: r.id,
      title,
      citation_key: r.citation_key,
      folder_path: r.folder_path,
    };
  });

  return Response.json({
    library: { id: lib.id, name: lib.name },
    sections: {
      papers: { items: papersRows },
      references: { items: refsRows },
      notes: { items: notesRows },
      agent: { items: AGENT_ITEMS },
    },
  });
}
