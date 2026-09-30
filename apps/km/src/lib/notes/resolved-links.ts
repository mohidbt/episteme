import { eq, sql } from "drizzle-orm";
import type { ResolvedLinksMap } from "@episteme/editor";
import { db } from "@/lib/db";
import { noteLinks, notes, papers, references_ } from "@episteme/db/schema";

/**
 * Resolved wiki-link targets for one note, keyed for the editor's hydration
 * pass. Shared by the note page and `GET /api/notes/[id]/resolved-links`.
 */
export async function getResolvedLinks(noteId: string): Promise<ResolvedLinksMap> {
  const linkRows = await db
    .select({
      title: noteLinks.targetTitleRaw,
      targetKind: noteLinks.targetKind,
      targetId: noteLinks.targetId,
      targetSlug: notes.slug,
      // GSD-62: resolved display label per kind.
      // - notes: notes.title
      // - papers: papers.title (nullable; fall back to filename)
      // - references: cslJson->>'title' (Postgres JSON arrow extraction)
      noteTitle: notes.title,
      paperTitle: papers.title,
      paperFilename: papers.filename,
      referenceTitle: sql<
        string | null
      >`${references_.cslJson}->>'title'`.as("reference_title"),
      referenceCitationKey: references_.citationKey,
    })
    .from(noteLinks)
    .leftJoin(notes, eq(notes.id, noteLinks.targetId))
    .leftJoin(papers, eq(papers.id, noteLinks.targetId))
    .leftJoin(references_, eq(references_.id, noteLinks.targetId))
    .where(eq(noteLinks.sourceNoteId, noteId));
  // K6: WikiLink node `title` attr stores the STRIPPED label (no `p:` / `r:`
  // / `@` / `pdf:` prefix). `note_links.target_title_raw` is also stored
  // STRIPPED. Key the resolvedLinks map by `${kind}::${title.toLowerCase()}`
  // so a paper "Foo" and a note "Foo" don't collide. Hydration in
  // `hydrate-wiki-links.ts` reads `node.attrs.targetKind` and looks up the
  // kind-qualified key, falling back to bare title for back-compat with
  // pre-classifier nodes (targetKind=null).
  return Object.fromEntries(
    linkRows.map((r) => {
      // GSD-62: pick the human-friendly title per kind.
      const displayTitle =
        r.targetKind === "note"
          ? r.noteTitle ?? null
          : r.targetKind === "paper"
            ? r.paperTitle ?? r.paperFilename ?? null
            : r.referenceTitle ?? r.referenceCitationKey ?? null;
      return [
        `${r.targetKind}::${r.title.toLowerCase()}`,
        {
          targetKind: r.targetKind,
          targetId: r.targetId,
          targetSlug: r.targetKind === "note" ? r.targetSlug ?? null : null,
          displayTitle,
        },
      ];
    }),
  );
}
