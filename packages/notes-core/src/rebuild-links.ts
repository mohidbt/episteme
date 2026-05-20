import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@episteme/db";
import {
  noteLinks,
  noteTags,
  notes,
  papers,
  references_,
} from "@episteme/db/schema";
import { extractLinks, extractTags, type Link } from "@episteme/markdown";

type ResolvedLink = {
  kind: Link["kind"];
  raw: string;
  targetId: string | null;
};

/**
 * Atomically rebuild `note_links` and `note_tags` rows for the given source
 * note. Wipes existing rows and inserts fresh ones derived from `md`.
 *
 * Link resolution is scoped to `userId`:
 *   - note      → case-insensitive title match in the user's notes (excluding self)
 *   - reference → citation_key match in the user's references
 *   - paper     → filename match in the user's papers (tie-break: most recent)
 *
 * Unresolved links persist with `targetId = null`; they can be back-filled
 * later by `resolveUnresolvedNoteLinks` when the referent is created.
 */
export async function rebuildLinks(
  sourceNoteId: string,
  md: string,
  userId: string,
): Promise<void> {
  const links = extractLinks(md);
  const tags = extractTags(md);

  const noteRaws = [...new Set(links.filter((l) => l.kind === "note").map((l) => l.raw))];
  const refRaws = [...new Set(links.filter((l) => l.kind === "reference").map((l) => l.raw))];
  const paperRaws = [...new Set(links.filter((l) => l.kind === "paper").map((l) => l.raw))];

  // Fanout: at most 3 resolution queries per rebuild, each with inArray().
  const [noteRows, refRows, paperRows] = await Promise.all([
    noteRaws.length > 0
      ? db
          .select({ id: notes.id, titleLower: sql<string>`lower(${notes.title})`.as("title_lower") })
          .from(notes)
          .where(
            and(
              eq(notes.userId, userId),
              ne(notes.id, sourceNoteId),
              inArray(
                sql`lower(${notes.title})`,
                noteRaws.map((r) => r.toLowerCase()),
              ),
            ),
          )
      : Promise.resolve([] as { id: string; titleLower: string }[]),
    refRaws.length > 0
      ? db
          .select({ id: references_.id, citationKey: references_.citationKey })
          .from(references_)
          .where(and(eq(references_.userId, userId), inArray(references_.citationKey, refRaws)))
      : Promise.resolve([] as { id: string; citationKey: string }[]),
    paperRaws.length > 0
      ? db
          .select({
            id: papers.id,
            filename: papers.filename,
            title: papers.title,
            addedAt: papers.addedAt,
          })
          .from(papers)
          .where(
            and(
              eq(papers.userId, userId),
              or(
                inArray(
                  sql`lower(${papers.title})`,
                  paperRaws.map((r) => r.toLowerCase()),
                ),
                inArray(papers.filename, paperRaws),
              ),
            ),
          )
          .orderBy(desc(papers.addedAt))
      : Promise.resolve(
          [] as {
            id: string;
            filename: string;
            title: string | null;
            addedAt: Date;
          }[],
        ),
  ]);

  const noteByTitle = new Map<string, string>();
  for (const r of noteRows) noteByTitle.set(r.titleLower, r.id);

  const refByKey = new Map<string, string>();
  for (const r of refRows) refByKey.set(r.citationKey, r.id);

  // Resolve papers by title OR filename (case-insensitive). The WikiLink
  // typeahead inserts `[[pdf:<paper.title>]]` while older content + the
  // search route's fallback can produce `[[pdf:<paper.filename>]]`. Both
  // forms must resolve so pills don't go red on refresh. desc(addedAt)
  // order from SQL already wins ties to the most recent paper.
  const paperByKey = new Map<string, string>();
  for (const r of paperRows) {
    if (r.title) {
      const k = r.title.toLowerCase();
      if (!paperByKey.has(k)) paperByKey.set(k, r.id);
    }
    if (r.filename) {
      const k = r.filename.toLowerCase();
      if (!paperByKey.has(k)) paperByKey.set(k, r.id);
    }
  }

  const resolved: ResolvedLink[] = links.map((l) => {
    let targetId: string | null = null;
    if (l.kind === "note") targetId = noteByTitle.get(l.raw.toLowerCase()) ?? null;
    else if (l.kind === "reference") targetId = refByKey.get(l.raw) ?? null;
    else if (l.kind === "paper") targetId = paperByKey.get(l.raw.toLowerCase()) ?? null;
    return { kind: l.kind, raw: l.raw, targetId };
  });

  await db.transaction(async (tx) => {
    await tx.delete(noteLinks).where(eq(noteLinks.sourceNoteId, sourceNoteId));
    await tx.delete(noteTags).where(eq(noteTags.noteId, sourceNoteId));

    if (resolved.length > 0) {
      await tx.insert(noteLinks).values(
        resolved.map((r) => ({
          sourceNoteId,
          targetKind: r.kind,
          targetId: r.targetId,
          targetTitleRaw: r.raw,
        })),
      );
    }

    if (tags.length > 0) {
      await tx.insert(noteTags).values(tags.map((tag) => ({ noteId: sourceNoteId, tag })));
    }
  });
}

/**
 * When a new note is created, back-fill `note_links` rows that referenced
 * it by title while it didn't yet exist.
 *
 * Scope: `target_kind = 'note'` only. Reference/paper retro-resolution
 * happens when references/papers are created — out of scope for Phase 0.7.
 */
export async function resolveUnresolvedNoteLinks(
  newNoteId: string,
  newTitle: string,
  userId: string,
): Promise<void> {
  await db
    .update(noteLinks)
    .set({ targetId: newNoteId })
    .where(
      and(
        eq(noteLinks.targetKind, "note"),
        isNull(noteLinks.targetId),
        sql`lower(${noteLinks.targetTitleRaw}) = lower(${newTitle})`,
        inArray(
          noteLinks.sourceNoteId,
          db.select({ id: notes.id }).from(notes).where(eq(notes.userId, userId)),
        ),
      ),
    );
}
