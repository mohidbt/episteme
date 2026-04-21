import { db } from "@/lib/db";
import { libraries, notes } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError, requireOwned, resolveNoteSlug } from "@/lib/crud";
import { toSlug } from "@/lib/slug";
import { parseFrontmatter } from "@/lib/io/md-frontmatter";
import { importLibraryZip, ZipImportError } from "@/lib/io/zip-import";

// pdfjs (via extractMetadata) + archiver require the Node runtime.
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type LibraryRow = typeof libraries.$inferSelect;

const MAX_ZIP_BYTES = 200 * 1024 * 1024;
const MAX_MD_BYTES = 2 * 1024 * 1024;

export async function POST(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");

  const { id } = await params;
  const libId = Number(id);
  if (!Number.isFinite(libId)) return jsonError(400, "invalid_id");

  const owned = await requireOwned<LibraryRow>(libraries, libId, userId);
  if (!owned.ok) {
    return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "validation", { message: "multipart/form-data required" });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonError(400, "validation", { message: "file required" });
  }

  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".zip")) {
    if (file.size > MAX_ZIP_BYTES) return jsonError(413, "file_too_large");
    const buf = Buffer.from(await file.arrayBuffer());
    try {
      const result = await importLibraryZip(userId, libId, buf);
      return Response.json(result);
    } catch (err) {
      if (err instanceof ZipImportError) {
        return jsonError(400, err.code, { path: err.path });
      }
      throw err;
    }
  }

  if (lowerName.endsWith(".md")) {
    if (file.size > MAX_MD_BYTES) return jsonError(413, "file_too_large");
    const rawFolderPath = form.get("folder_path");
    const folderPath = typeof rawFolderPath === "string" ? rawFolderPath : "";
    const raw = await file.text();
    const { data, content } = parseFrontmatter(raw);
    const baseName = file.name.replace(/\.md$/i, "");
    const title =
      typeof data.title === "string" && data.title.length > 0
        ? data.title
        : baseName;
    const slugHint =
      typeof data.slug === "string" && data.slug.length > 0
        ? toSlug(data.slug)
        : undefined;
    const slug = await resolveNoteSlug(userId, slugHint ?? title);

    await db.insert(notes).values({
      libraryId: libId,
      userId,
      folderPath,
      title,
      slug,
      filename: file.name,
      contentMd: content,
    });

    return Response.json({ imported: 1, skipped: 0, conflicts: [] });
  }

  return jsonError(400, "unsupported_file_type", { name: file.name });
}
