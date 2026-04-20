import { cache } from "react";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { libraries, notes, papers, references_ } from "@episteme/db/schema";

const AGENT_ITEMS = [
  { kind: "skills", label: "skills.md" },
  { kind: "memory", label: "memory.md" },
  { kind: "settings", label: "settings.json" },
] as const;

export interface PaperItem {
  id: string;
  title: string | null;
  folder_path: string;
}

export interface ReferenceItem {
  id: string;
  title: string;
  citation_key: string;
  folder_path: string;
}

export interface NoteItem {
  id: string;
  title: string;
  slug: string;
  folder_path: string;
}

export interface AgentItem {
  kind: "skills" | "memory" | "settings";
  label: string;
}

export interface TreeResponse {
  library: { id: number; name: string };
  sections: {
    papers: { items: PaperItem[] };
    references: { items: ReferenceItem[] };
    notes: { items: NoteItem[] };
    agent: { items: readonly AgentItem[] };
  };
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

    const refsRows: ReferenceItem[] = refsRowsRaw.map((r) => {
      const csl = r.csl_json as { title?: string } | null;
      const title: string = csl?.title ?? r.citation_key;
      return {
        id: r.id,
        title,
        citation_key: r.citation_key,
        folder_path: r.folder_path,
      };
    });

    return {
      library: { id: lib.id, name: lib.name },
      sections: {
        papers: { items: papersRows },
        references: { items: refsRows },
        notes: { items: notesRows },
        agent: { items: AGENT_ITEMS },
      },
    };
  },
);
