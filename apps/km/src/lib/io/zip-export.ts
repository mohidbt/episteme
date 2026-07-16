import archiver from "archiver";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { libraries, notes, references_, papers } from "@episteme/db/schema";
import { storage, paperSourceKey } from "@/lib/storage";
import { getSkillStore } from "@/lib/skills-store";
import { archiveRelativePath, sanitizeArchiveSegment } from "@/lib/filename";

export type Section = "notes" | "papers" | "references" | "all";

const PRESIGN_TTL_SEC = 600;

function sanitizeLibName(name: string): string {
  return sanitizeArchiveSegment(name, "library");
}

/**
 * Append personal skills under `skills/<slug>/SKILL.json` to an open archive.
 * Personal skills only — system skills live in the agent service, not the
 * user's library. Failures here are warnings, never fatal: an unreadable
 * skill should not poison a notes/papers export.
 */
export async function appendPersonalSkills(
  archive: archiver.Archiver,
  userId: string,
): Promise<void> {
  try {
    const store = getSkillStore();
    const manifests = await store.list(userId);
    for (const m of manifests) {
      const content = await store.read(userId, m.slug);
      const skillPath = archiveRelativePath(
        `skills/${sanitizeArchiveSegment(m.slug, "skill")}`,
        "SKILL.json",
      );
      if (skillPath) archive.append(content, { name: skillPath });
    }
  } catch (err) {
    console.warn("[zip-export] personal skills append failed", err);
  }
}

function notesFrontmatter(title: string, slug: string, folderPath: string): string {
  return (
    "---\n" +
    `title: ${JSON.stringify(title)}\n` +
    `slug: ${slug}\n` +
    `folder_path: ${JSON.stringify(folderPath)}\n` +
    "---\n\n"
  );
}

/**
 * Streaming zip export. Returns a Node Readable — pipe to a buffer in tests
 * or wrap with Readable.toWeb() for a Next Response.
 *
 * Folder segments are assumed slash-safe (folder creation rejects `/` and `\`
 * at the source). Paper filenames come from `papers.filename` (notNull).
 */
export function exportLibraryZip(opts: {
  libraryId: number;
  section: Section;
  /** When set and section === "all", personal skills are included under skills/. */
  userId?: string;
}): archiver.Archiver {
  const archive = archiver("zip", { zlib: { level: 9 } });

  (async () => {
    try {
      const [lib] = await db
        .select()
        .from(libraries)
        .where(eq(libraries.id, opts.libraryId));
      if (!lib) {
        archive.finalize();
        return;
      }
      const safeLib = sanitizeLibName(lib.name);

      if (opts.section === "notes" || opts.section === "all") {
        const rows = await db
          .select()
          .from(notes)
          .where(eq(notes.libraryId, opts.libraryId));
        for (const n of rows) {
          const body =
            notesFrontmatter(n.title, n.slug, n.folderPath) + n.contentMd;
          const relativePath = archiveRelativePath(
            n.folderPath,
            `${n.slug}.md`,
            "note.md",
          );
          if (!relativePath) continue;
          archive.append(body, {
            name: `${safeLib}/notes/${relativePath}`,
          });
        }
      }

      if (opts.section === "references" || opts.section === "all") {
        const rows = await db
          .select()
          .from(references_)
          .where(eq(references_.libraryId, opts.libraryId));
        for (const r of rows) {
          const json = JSON.stringify(r.cslJson ?? {}, null, 2);
          const relativePath = archiveRelativePath(
            r.folderPath,
            `${r.citationKey}.json`,
            "reference.json",
          );
          if (!relativePath) continue;
          archive.append(json, {
            name: `${safeLib}/references/${relativePath}`,
          });
        }
      }

      if (opts.section === "papers" || opts.section === "all") {
        const rows = await db
          .select()
          .from(papers)
          .where(eq(papers.libraryId, opts.libraryId));
        for (const p of rows) {
          const relativePath = archiveRelativePath(
            p.folderPath,
            p.filename,
            "paper.pdf",
          );
          if (!relativePath) continue;
          const url = await storage.getPresignedGet(
            paperSourceKey(p.id),
            PRESIGN_TTL_SEC,
          );
          const resp = await fetch(url);
          if (!resp.ok) continue;
          const bytes = Buffer.from(await resp.arrayBuffer());
          archive.append(bytes, {
            name: `${safeLib}/papers/${relativePath}`,
          });
        }
      }

      if (opts.section === "all" && opts.userId) {
        await appendPersonalSkills(archive, opts.userId);
      }

      archive.finalize();
    } catch (err) {
      archive.destroy(err as Error);
    }
  })();

  return archive;
}
