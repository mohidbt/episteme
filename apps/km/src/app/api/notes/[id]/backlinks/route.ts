import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes, noteLinks } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/crud";

type Ctx = { params: Promise<{ id: string }> };

function computeSnippet(contentMd: string, title: string): string {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\[\\[${escaped}(?:\\|[^\\]]*)?\\]\\]`, "i");
  const match = re.exec(contentMd);

  let raw: string;
  if (match) {
    const idx = match.index;
    const start = Math.max(0, idx - 60);
    const end = Math.min(contentMd.length, idx + match[0].length + 60);
    raw = contentMd.slice(start, end);
  } else {
    raw = contentMd.slice(0, 120);
  }

  return raw.replace(/\n+/g, " ").trim();
}

export async function GET(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");

  const { id } = await params;

  const [targetNote] = await db
    .select({ id: notes.id, title: notes.title })
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId)));
  if (!targetNote) return jsonError(404, "not_found");

  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      slug: notes.slug,
      contentMd: notes.contentMd,
    })
    .from(noteLinks)
    .innerJoin(notes, eq(noteLinks.sourceNoteId, notes.id))
    .where(
      and(
        eq(noteLinks.targetKind, "note"),
        eq(noteLinks.targetId, id),
        eq(notes.userId, userId),
      ),
    )
    .limit(100);

  const sources = rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    snippet: computeSnippet(row.contentMd ?? "", targetNote.title),
  }));

  return Response.json({ sources });
}
