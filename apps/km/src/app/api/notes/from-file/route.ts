import { db } from "@/lib/db";
import { notes, libraries } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError, requireOwned, resolveNoteSlug } from "@/lib/crud";
import { resolveUnresolvedNoteLinks, createRevisionIfNeeded } from "@episteme/notes-core";

export const runtime = "nodejs";

const MAX_NOTE_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const SUPPORTED_EXTS = new Set(["md", "markdown", "txt"]);

function extractExt(filename: string): string {
  return filename.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
}

function titleFromFilename(filename: string): string {
  // Strip extension
  return filename.replace(/\.[^.]+$/, "");
}

function parseNoteContent(raw: string): { title: string; contentMd: string } {
  const lines = raw.split("\n");
  const firstLine = lines[0] ?? "";
  if (firstLine.startsWith("# ")) {
    const title = firstLine.slice(2).trim();
    const rest = lines.slice(1).join("\n").trimStart();
    return { title, contentMd: rest };
  }
  return { title: "", contentMd: raw };
}

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "validation", { message: "multipart/form-data required" });
  }

  const libraryIdRaw = form.get("libraryId");
  const folderPathRaw = form.get("folderPath");
  const folderIdRaw = form.get("folderId");
  const file = form.get("file");

  if (typeof libraryIdRaw !== "string") return jsonError(400, "validation", { message: "libraryId required" });
  const libraryId = Number.parseInt(libraryIdRaw, 10);
  if (!Number.isFinite(libraryId)) return jsonError(400, "validation", { message: "libraryId must be an integer" });
  if (!(file instanceof File)) return jsonError(400, "validation", { message: "file required" });

  const ext = extractExt(file.name);
  if (!SUPPORTED_EXTS.has(ext)) {
    return jsonError(400, "unsupported_file_type", { message: "Only .md, .markdown, and .txt files are supported" });
  }

  if (file.size > MAX_NOTE_FILE_BYTES) return jsonError(413, "file_too_large");

  const lib = await requireOwned<any>(libraries, libraryId, userId);
  if (!lib.ok) return jsonError(lib.status, lib.status === 404 ? "not_found" : "forbidden");

  const content = await file.text();
  const { title: headingTitle, contentMd } = parseNoteContent(content);
  const title = headingTitle || titleFromFilename(file.name);

  const folderPath = typeof folderPathRaw === "string" ? folderPathRaw : "";
  const folderId = typeof folderIdRaw === "string" ? folderIdRaw : null;

  const slug = await resolveNoteSlug(userId, title);

  const [row] = await db
    .insert(notes)
    .values({
      libraryId,
      userId,
      folderPath,
      ...(folderId ? { folderId } : {}),
      title,
      slug,
      contentMd,
    })
    .returning();

  await resolveUnresolvedNoteLinks(row.id, row.title, userId);
  await createRevisionIfNeeded({
    noteId: row.id,
    authorId: userId,
    newMd: row.contentMd ?? "",
    reason: "manual",
  });

  return Response.json(row, { status: 201 });
}
