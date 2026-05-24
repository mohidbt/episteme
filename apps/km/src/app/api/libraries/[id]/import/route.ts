import { db } from "@/lib/db";
import { libraries, notes } from "@episteme/db/schema";
import { getSessionInfo } from "@/lib/auth";
import { jsonError, requireOwned, resolveNoteSlug } from "@/lib/crud";
import { toSlug } from "@/lib/slug";
import { parseFrontmatter } from "@/lib/io/md-frontmatter";
import { assertWithinLibraryLimit } from "@/lib/library-usage";

// pdfjs (via extractMetadata) requires the Node runtime.
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type LibraryRow = typeof libraries.$inferSelect;

// B12: per-tier byte caps. .zip import was removed; uploads are now
// scoped to one of the supported single-file kinds.
const MB = 1024 * 1024;
const MAX_MD_BYTES = 5 * MB;
const MAX_PDF_BYTES = 50 * MB;
const MAX_REFERENCE_BYTES = 5 * MB;
const MAX_CSV_BYTES = 1 * MB;
const MAX_IMAGE_BYTES = 5 * MB;

type AllowedKind = "md" | "pdf" | "reference" | "csv" | "image";

type Rule = {
  kind: AllowedKind;
  maxBytes: number;
  exts: readonly string[];
  // MIME types that are allowed for this kind. Empty MIME from the browser
  // is tolerated (some OSes do not stamp a Content-Type on form uploads),
  // but a *present* MIME must be in this list — defends vs spoofed types
  // claiming application/octet-stream is a PDF, etc.
  mimes: readonly string[];
  mimePrefixes?: readonly string[];
};

const UPLOAD_RULES: readonly Rule[] = [
  {
    kind: "md",
    maxBytes: MAX_MD_BYTES,
    exts: [".md"],
    mimes: ["text/markdown", "text/x-markdown", "text/plain"],
  },
  {
    kind: "pdf",
    maxBytes: MAX_PDF_BYTES,
    exts: [".pdf"],
    mimes: ["application/pdf"],
  },
  {
    kind: "reference",
    maxBytes: MAX_REFERENCE_BYTES,
    exts: [".bib", ".ris", ".csl-json", ".csljson", ".json"],
    mimes: [
      "application/x-bibtex",
      "application/x-research-info-systems",
      "application/vnd.citationstyles.csl+json",
      "application/json",
      "text/plain",
    ],
  },
  {
    kind: "csv",
    maxBytes: MAX_CSV_BYTES,
    exts: [".csv"],
    mimes: ["text/csv", "application/csv", "text/plain"],
  },
  {
    kind: "image",
    maxBytes: MAX_IMAGE_BYTES,
    exts: [".jpg", ".jpeg", ".png", ".webp"],
    mimes: [],
    mimePrefixes: ["image/"],
  },
];

function classifyUpload(
  file: File,
): { kind: AllowedKind; maxBytes: number } | null {
  const name = file.name.toLowerCase();
  const type = (file.type ?? "").toLowerCase();

  for (const rule of UPLOAD_RULES) {
    const extMatch = rule.exts.some((e) => name.endsWith(e));
    if (!extMatch) continue;

    // No MIME stamped by the browser → trust the extension.
    if (!type) return { kind: rule.kind, maxBytes: rule.maxBytes };

    const mimeMatch =
      rule.mimes.includes(type) ||
      (rule.mimePrefixes?.some((p) => type.startsWith(p)) ?? false);
    if (mimeMatch) return { kind: rule.kind, maxBytes: rule.maxBytes };
    // Extension agrees but MIME doesn't — treat as spoofed and reject.
    return null;
  }
  return null;
}

export async function POST(req: Request, { params }: Ctx) {
  const session = await getSessionInfo(req);
  if (!session) return jsonError(401, "unauthorized");
  // Guests get a free-tier read-only experience; import would let them
  // bypass the OR spend cap by smuggling in arbitrary content.
  if (session.isAnonymous) return jsonError(403, "guest_forbidden");
  const userId = session.userId;

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

  const rawFolderId = form.get("folderId");
  const folderId = typeof rawFolderId === "string" && rawFolderId.length > 0
    ? rawFolderId
    : null;

  const classified = classifyUpload(file);
  if (!classified) {
    return jsonError(415, "unsupported_file_type", { name: file.name });
  }
  if (file.size > classified.maxBytes) {
    return jsonError(413, "file_too_large", {
      kind: classified.kind,
      max: classified.maxBytes,
    });
  }

  if (classified.kind === "md") {
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

    const sizeBytes = Buffer.byteLength(content, "utf8");
    const cap = await assertWithinLibraryLimit(libId, sizeBytes);
    if (!cap.ok) {
      return jsonError(413, "over_limit", {
        usedBytes: cap.usedBytes,
        limitBytes: cap.limitBytes,
      });
    }

    await db.insert(notes).values({
      libraryId: libId,
      userId,
      folderPath,
      folderId,
      title,
      slug,
      filename: file.name,
      contentMd: content,
      sizeBytes,
    });

    return Response.json({ imported: 1, skipped: 0, conflicts: [] });
  }

  // PDF / reference / csv / image kinds pass size+type validation but do not
  // yet have a server-side import handler — surface a clear 415 so the
  // client knows the file is recognised but the pipeline isn't wired.
  return jsonError(415, "import_handler_not_implemented", {
    kind: classified.kind,
  });
}
