// GSD-9 — Skills-only export. The legacy /api/agent/export still serves the
// full agent-config bundle (used by the settings/data full-config export).
// This route is scoped to skill folders only — system + personal — so the
// Skills tab "Export skills" button doesn't accidentally exfiltrate the
// agent_config/memory/settings payload.
import { getSessionInfo } from "@/lib/auth";
import { buildSkillsOnly } from "@/lib/agent-config-bundle";
import { jsonError } from "@/lib/crud";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getSessionInfo(req);
  if (!session) return jsonError(401, "unauthorized");
  const userId = session.userId;
  const zip = await buildSkillsOnly(userId);
  const body = zip.buffer.slice(
    zip.byteOffset,
    zip.byteOffset + zip.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="episteme-skills-${userId}-${Date.now()}.zip"`,
    },
  });
}
