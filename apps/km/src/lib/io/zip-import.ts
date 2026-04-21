import unzipper from "unzipper";
import { db } from "@/lib/db";
import { notes, papers, references_ } from "@episteme/db/schema";
import { toSlug } from "@/lib/slug";
import { storage, paperSourceKey } from "@/lib/storage";
import { extractMetadata } from "@/lib/pdf-extract";
import { isUniqueViolation, suggestNextCitationKey } from "@/lib/references";
import { resolveNoteSlug } from "@/lib/crud";
import { parseFrontmatter } from "./md-frontmatter";

export interface ImportConflict {
  section: "notes" | "references" | "papers";
  path: string;
  reason: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  conflicts: ImportConflict[];
}

export class ZipImportError extends Error {
  code: "path_traversal" | "invalid_filename" | "unreadable";
  path?: string;
  constructor(code: "path_traversal" | "invalid_filename" | "unreadable", path?: string) {
    super(`zip_import_${code}${path ? `: ${path}` : ""}`);
    this.code = code;
    this.path = path;
  }
}

function validatePath(p: string): void {
  if (p.startsWith("/")) throw new ZipImportError("path_traversal", p);
  if (p.includes("\0")) throw new ZipImportError("invalid_filename", p);
  if (p.includes("\uFFFD")) throw new ZipImportError("invalid_filename", p);
  // Reject any segment equal to ".." — covers "a/../b" and "../a".
  const segments = p.split("/");
  for (const seg of segments) {
    if (seg === "..") throw new ZipImportError("path_traversal", p);
  }
}

/**
 * Import a library zip into the given library.
 *
 * Path shape inside the zip: `<LibName>/<section>/<folderPath>/<filename>`.
 * - Notes: `.md` files. Frontmatter `title`/`slug` override filename-derived defaults.
 *   Slug collisions retry with `-2`, `-3`, ... per `resolveNoteSlug`.
 * - References: `.json` files. CSL parsed + `id` synthesized from filename if missing.
 *   Citation-key collisions retry via `insertReferenceWithSuffixBump`.
 * - Papers: `.pdf` files. Uploaded to MinIO at `<id>/source.pdf` inside the
 *   transaction — upload failure rolls back.
 *
 * Returns `{ imported, skipped, conflicts }`. Does not throw on duplicate slugs
 * or citation keys — these are reflected as conflicts with bumped suffixes.
 */
export async function importLibraryZip(
  userId: string,
  libraryId: number,
  buf: Buffer,
): Promise<ImportResult> {
  let dir: unzipper.CentralDirectory;
  try {
    dir = await unzipper.Open.buffer(buf);
  } catch (err) {
    throw new ZipImportError("unreadable", (err as Error).message);
  }

  const conflicts: ImportConflict[] = [];
  let imported = 0;
  let skipped = 0;

  // Validate all paths up front so we refuse the whole zip on traversal —
  // no partial mutation, no need to wait until the tx sees the bad entry.
  const utf8Validator = new TextDecoder("utf-8", { fatal: true });
  for (const entry of dir.files) {
    if (!entry.path) throw new ZipImportError("invalid_filename");
    const pathBuffer = (entry as unknown as { pathBuffer?: Buffer }).pathBuffer;
    if (pathBuffer) {
      try {
        utf8Validator.decode(pathBuffer);
      } catch {
        throw new ZipImportError("invalid_filename", entry.path);
      }
    }
    validatePath(entry.path);
  }

  await db.transaction(async (tx) => {
    for (const entry of dir.files) {
      if (entry.type === "Directory") continue;
      if (entry.path.endsWith("/")) continue;

      const parts = entry.path.split("/");
      parts.shift(); // drop library-name prefix
      const section = parts.shift();
      if (section !== "notes" && section !== "references" && section !== "papers") {
        continue;
      }
      const filename = parts.pop();
      if (!filename) continue;
      const folderPath = parts.length ? parts.join("/") + "/" : "";

      const bytes = await entry.buffer();

      if (section === "notes" && filename.toLowerCase().endsWith(".md")) {
        const raw = bytes.toString("utf8");
        const { data, content } = parseFrontmatter(raw);
        const baseName = filename.replace(/\.md$/i, "");
        const title =
          typeof data.title === "string" && data.title.length > 0
            ? data.title
            : baseName;

        // `resolveNoteSlug(userId, seed)` slugifies `seed` then scans forward
        // for a free candidate. When the frontmatter pins an explicit slug,
        // pass it as the seed; otherwise feed the filename-derived baseName.
        // `toSlug` is idempotent on slug-shaped input, so this works for both.
        const slugSeed =
          typeof data.slug === "string" && data.slug.length > 0
            ? data.slug
            : baseName;
        const baseSlug = toSlug(slugSeed);
        let slug = await resolveNoteSlug(userId, slugSeed);
        let attempts = 0;
        while (true) {
          try {
            await tx.insert(notes).values({
              libraryId,
              userId,
              folderPath,
              title,
              slug,
              filename,
              contentMd: content,
            });
            break;
          } catch (err) {
            // Race: another tx inserted the same slug between our scan and
            // our insert. Bump and retry.
            if (!isUniqueViolation(err) || attempts > 20) throw err;
            attempts++;
            slug = bumpSlug(slug);
          }
        }
        if (slug !== baseSlug) {
          conflicts.push({
            section: "notes",
            path: entry.path,
            reason: `slug_bumped: ${baseSlug} -> ${slug}`,
          });
        }
        imported++;
      } else if (
        section === "references" &&
        filename.toLowerCase().endsWith(".json")
      ) {
        const baseKey = filename.replace(/\.json$/i, "");
        let csl: Record<string, unknown>;
        try {
          csl = JSON.parse(bytes.toString("utf8"));
        } catch (err) {
          conflicts.push({
            section: "references",
            path: entry.path,
            reason: `parse_failed: ${(err as Error).message}`,
          });
          skipped++;
          continue;
        }
        // The plan says to trust CSL shape (validation is strict — requires
        // `id`+`type`). Synthesize any missing fields from the filename so
        // round-trip from our own export always works, and user-crafted
        // imports don't fail on missing boilerplate.
        if (typeof csl.id !== "string") csl.id = baseKey;
        if (typeof csl.type !== "string") csl.type = "document";

        let key = baseKey;
        let bumped = false;
        let attempts = 0;
        while (true) {
          try {
            await tx.insert(references_).values({
              libraryId,
              userId,
              folderPath,
              citationKey: key,
              cslJson: csl,
            });
            break;
          } catch (err) {
            if (!isUniqueViolation(err) || attempts > 20) throw err;
            key = suggestNextCitationKey(key);
            bumped = true;
            attempts++;
          }
        }
        if (bumped) {
          conflicts.push({
            section: "references",
            path: entry.path,
            reason: `citation_key_bumped: ${baseKey} -> ${key}`,
          });
        }
        imported++;
      } else if (
        section === "papers" &&
        filename.toLowerCase().endsWith(".pdf")
      ) {
        const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const meta = await extractMetadata(u8, filename);
        const [row] = await tx
          .insert(papers)
          .values({
            libraryId,
            userId,
            folderPath,
            filename,
            title: meta.title || filename.replace(/\.pdf$/i, ""),
            authors: meta.authors.length > 0 ? meta.authors : null,
            year: typeof meta.year === "number" ? meta.year : null,
            doi: typeof meta.doi === "string" ? meta.doi : null,
            storageUrl: null,
          })
          .returning({ id: papers.id });
        // Upload inside the transaction: if this throws, the insert rolls
        // back. Acceptable tradeoff: other failure modes can leave an
        // orphan MinIO blob (see plan's correction #9).
        await storage.uploadObject(
          paperSourceKey(row.id),
          bytes,
          "application/pdf",
        );
        imported++;
      }
    }
  });

  return { imported, skipped, conflicts };
}

// ---- helpers ---------------------------------------------------------------

function bumpSlug(slug: string): string {
  const m = slug.match(/^(.+)-(\d+)$/);
  if (m) {
    return `${m[1]}-${Number.parseInt(m[2], 10) + 1}`;
  }
  return `${slug}-2`;
}
