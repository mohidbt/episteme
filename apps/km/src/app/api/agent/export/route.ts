// GET /api/agent/export — cookie-auth zip download of the user's agent config
// bundle. Wraps `buildBundle` from agent-config-bundle (T9).
import { getSessionInfo } from "@/lib/auth";
import { buildBundle } from "@/lib/agent-config-bundle";
import { jsonError } from "@/lib/crud";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getSessionInfo(req);
  if (!session) return jsonError(401, "unauthorized");
  const userId = session.userId;
  const zip = await buildBundle(userId);
  // Slice to a fresh ArrayBuffer — Response/BodyInit doesn't accept Uint8Array
  // typing across all TS lib versions; the slice gives us a plain ArrayBuffer.
  const body = zip.buffer.slice(
    zip.byteOffset,
    zip.byteOffset + zip.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="episteme-agent-config-${userId}-${Date.now()}.zip"`,
    },
  });
}
