import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/crud";
import { getTreeForUser } from "@/lib/tree-server";

export async function GET(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const url = new URL(req.url);
  const libraryIdStr = url.searchParams.get("libraryId");
  if (!libraryIdStr) return jsonError(400, "validation", { message: "libraryId required" });
  const libraryId = Number(libraryIdStr);
  if (!Number.isFinite(libraryId)) return jsonError(400, "validation", { message: "libraryId must be a number" });

  const tree = await getTreeForUser(libraryId, userId);
  if (!tree) return jsonError(404, "not_found");
  return Response.json(tree);
}
