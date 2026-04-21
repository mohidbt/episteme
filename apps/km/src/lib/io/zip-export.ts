import archiver from "archiver";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { libraries, notes, references_, papers } from "@episteme/db/schema";
import { storage, paperSourceKey } from "@/lib/storage";

export type Section = "notes" | "papers" | "references" | "all";

const PRESIGN_TTL_SEC = 600;

function sanitizeLibName(name: string): string {
  return name.replace(/[\/\\]/g, "-");
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
          archive.append(body, {
            name: `${safeLib}/notes/${n.folderPath}${n.slug}.md`,
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
          archive.append(json, {
            name: `${safeLib}/references/${r.folderPath}${r.citationKey}.json`,
          });
        }
      }

      if (opts.section === "papers" || opts.section === "all") {
        const rows = await db
          .select()
          .from(papers)
          .where(eq(papers.libraryId, opts.libraryId));
        for (const p of rows) {
          const url = await storage.getPresignedGet(
            paperSourceKey(p.id),
            PRESIGN_TTL_SEC,
          );
          const resp = await fetch(url);
          if (!resp.ok) continue;
          const bytes = Buffer.from(await resp.arrayBuffer());
          archive.append(bytes, {
            name: `${safeLib}/papers/${p.folderPath}${p.filename}`,
          });
        }
      }

      archive.finalize();
    } catch (err) {
      archive.destroy(err as Error);
    }
  })();

  return archive;
}
