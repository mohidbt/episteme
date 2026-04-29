import { cache } from "react";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { folders, libraries, notes, papers, papersets, references_ } from "@episteme/db/schema";

const AGENT_ITEMS = [
  { kind: "skills", label: "skills.md" },
  { kind: "memory", label: "memory.md" },
  { kind: "settings", label: "settings.json" },
] as const;

export interface FolderRowOut {
  id: string;
  name: string;
  parentId: string | null;
  isTrash: boolean;
  sortOrder: number;
}

export interface PaperItem {
  id: string;
  title: string | null;
  folderId: string | null;
}

export interface ReferenceItem {
  id: string;
  title: string;
  citationKey: string;
  folderId: string | null;
}

export interface NoteItem {
  id: string;
  title: string;
  slug: string;
  folderId: string | null;
}

export interface PapersetItem {
  id: string;
  title: string;
  folderId: string | null;
}

export interface AgentItem {
  kind: "skills" | "memory" | "settings";
  label: string;
}

export interface TreeResponse {
  library: { id: number; name: string };
  folders: FolderRowOut[];
  papers: PaperItem[];
  references: ReferenceItem[];
  notes: NoteItem[];
  papersets: PapersetItem[];
  agent: readonly AgentItem[];
}

export const getTreeForUser = cache(
  async (libraryId: number, userId: string): Promise<TreeResponse | null> => {
    const libRows = await db
      .select({ id: libraries.id, name: libraries.name })
      .from(libraries)
      .where(and(eq(libraries.id, libraryId), eq(libraries.userId, userId)))
      .limit(1);
    const lib = libRows[0];
    if (!lib) return null;

    const [folderRows, papersRows, refsRowsRaw, notesRows, papersetsRows] = await Promise.all([
      db
        .select({
          id: folders.id,
          name: folders.name,
          parentId: folders.parentId,
          isTrash: folders.isTrash,
          sortOrder: folders.sortOrder,
        })
        .from(folders)
        .where(and(eq(folders.libraryId, libraryId), eq(folders.userId, userId)))
        .orderBy(asc(folders.sortOrder), asc(folders.name)),
      db
        .select({ id: papers.id, title: papers.title, folderId: papers.folderId })
        .from(papers)
        .where(and(eq(papers.libraryId, libraryId), eq(papers.userId, userId)))
        .orderBy(asc(papers.addedAt)),
      db
        .select({
          id: references_.id,
          citationKey: references_.citationKey,
          cslJson: references_.cslJson,
          folderId: references_.folderId,
        })
        .from(references_)
        .where(and(eq(references_.libraryId, libraryId), eq(references_.userId, userId)))
        .orderBy(asc(references_.createdAt)),
      db
        .select({
          id: notes.id,
          title: notes.title,
          slug: notes.slug,
          folderId: notes.folderId,
        })
        .from(notes)
        .where(and(eq(notes.libraryId, libraryId), eq(notes.userId, userId)))
        .orderBy(asc(notes.createdAt)),
      db
        .select({
          id: papersets.id,
          filename: papersets.filename,
          folderId: papersets.folderId,
        })
        .from(papersets)
        .where(and(eq(papersets.libraryId, libraryId), eq(papersets.userId, userId)))
        .orderBy(asc(papersets.createdAt)),
    ]);

    const refsRows: ReferenceItem[] = refsRowsRaw.map((r) => {
      const csl = r.cslJson as { title?: string } | null;
      const title: string = csl?.title ?? r.citationKey;
      return {
        id: r.id,
        title,
        citationKey: r.citationKey,
        folderId: r.folderId,
      };
    });

    return {
      library: { id: lib.id, name: lib.name },
      folders: folderRows,
      papers: papersRows,
      references: refsRows,
      notes: notesRows,
      papersets: papersetsRows.map((p) => ({
        id: p.id,
        title: p.filename,
        folderId: p.folderId,
      })),
      agent: AGENT_ITEMS,
    };
  },
);
