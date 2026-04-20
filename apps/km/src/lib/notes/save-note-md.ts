import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";
import { mdToProseMirror } from "@episteme/markdown";

export async function saveNoteMd(id: string, contentMd: string): Promise<void> {
  const contentJson = mdToProseMirror(contentMd);
  await db
    .update(notes)
    .set({ contentMd, contentJson, updatedAt: new Date() })
    .where(eq(notes.id, id));
  // TODO(phase-0.5): rebuild note_links from [[...]] regex
  // TODO(phase-0.6): create note_revisions row per PRD §4.6 triggers
}
