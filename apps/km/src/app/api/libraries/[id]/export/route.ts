import { Readable } from "node:stream";
import { libraries } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError, requireOwned } from "@/lib/crud";
import { exportLibraryZip, type Section } from "@/lib/io/zip-export";
import { attachmentContentDisposition } from "@/lib/filename";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type LibraryRow = typeof libraries.$inferSelect;

const VALID_SECTIONS: readonly Section[] = ["notes", "papers", "references", "all"];

export async function GET(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");

  const { id } = await params;
  const libId = Number(id);
  if (!Number.isFinite(libId)) return jsonError(400, "invalid_id");

  const owned = await requireOwned<LibraryRow>(libraries, libId, userId);
  if (!owned.ok) {
    return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");
  }
  const lib = owned.row;

  const rawSection = new URL(req.url).searchParams.get("section") ?? "all";
  const section = (VALID_SECTIONS as readonly string[]).includes(rawSection)
    ? (rawSection as Section)
    : "all";

  const archive = exportLibraryZip({ libraryId: libId, section, userId });
  const webStream = Readable.toWeb(archive) as unknown as ReadableStream<Uint8Array>;

  return new Response(webStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": attachmentContentDisposition(`${lib.name}.zip`),
    },
  });
}
