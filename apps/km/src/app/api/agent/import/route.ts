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

export async function POST(req: Request) {
  const session = await getSessionInfo(req);
  if (!session) return jsonError(401, "unauthorized");
  const userId = session.userId;

  const fd = await req.formData();
  const file = fd.get("file");
  if (!(file instanceof File)) return jsonError(400, "missing_file");
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
