// POST /api/agent/import — cookie-auth multipart upload of an agent config
// bundle. Without `confirm=true` returns the diff JSON; with `confirm=true`
// applies the bundle (additive merge per T9).
import { getSessionInfo } from "@/lib/auth";
import {
  applyBundle,
  diffBundle,
  parseBundle,
  type AgentConfigBundle,
} from "@/lib/agent-config-bundle";
import { jsonError } from "@/lib/crud";

export const runtime = "nodejs";
const MAX_BUNDLE_FILE_BYTES = 5 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_BUNDLE_FILE_BYTES + 256 * 1024;

export async function POST(req: Request) {
  const session = await getSessionInfo(req);
  if (!session) return jsonError(401, "unauthorized");
  if (session.isAnonymous) return jsonError(403, "guest_forbidden");
  const userId = session.userId;

  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
    return jsonError(413, "file_too_large");
  }
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return jsonError(400, "invalid_multipart");
  }
  const file = fd.get("file");
  if (!(file instanceof File)) return jsonError(400, "missing_file");
  if (file.size > MAX_BUNDLE_FILE_BYTES) return jsonError(413, "file_too_large");
  const confirm = fd.get("confirm") === "true";

  const buf = new Uint8Array(await file.arrayBuffer());
  let bundle: AgentConfigBundle;
  try {
    bundle = await parseBundle(buf);
  } catch (e) {
    return jsonError(400, "invalid_bundle", { detail: String(e) });
  }

  if (!confirm) {
    const diff = await diffBundle(userId, bundle);
    return Response.json({ diff });
  }
  await applyBundle(userId, bundle);
  return Response.json({ ok: true });
}
