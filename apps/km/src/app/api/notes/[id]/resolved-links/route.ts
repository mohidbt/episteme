import { notes } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { jsonError, requireOwned } from "@/lib/crud";
import { getResolvedLinks } from "@/lib/notes/resolved-links";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  let authed;
  try { authed = await getAuthedUserId(req); }
  catch (e) { if (e instanceof MissingInternalSecretError) return jsonError(500, "internal auth misconfigured"); throw e; }
  if (!authed) return jsonError(401, "unauthorized");
  const { id } = await params;
  const res = await requireOwned<any>(notes, id, authed.userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  return Response.json(await getResolvedLinks(id));
}
