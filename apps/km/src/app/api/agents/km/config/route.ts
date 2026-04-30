import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSessionInfo } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentConfigs } from "@episteme/db/schema";
import { signRequest } from "@/lib/agents/sign-request";
import { getDefaultAgentModel } from "@/lib/agent-config-defaults";

const PatchBody = z
  .object({
    enabledSkills: z.array(z.string()).optional(),
    attachedMcps: z.unknown().optional(),
    modelPreference: z.string().optional(),
    approvalRules: z.unknown().optional(),
    // Per-tool opt-in flags (e.g. { web_search: true }). Stored inside
    // settingsJson.permissions so no schema migration is needed.
    permissions: z.record(z.string(), z.boolean()).optional(),
  })
  .strict();

export async function GET(req: Request) {
  const session = await getSessionInfo(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, session.userId));

  if (rows.length > 0) {
    return Response.json(toResponse(rows[0]));
  }

  // No row — insert defaults and return
  const inserted = await db
    .insert(agentConfigs)
    .values({ userId: session.userId, modelPreference: getDefaultAgentModel() })
    .onConflictDoUpdate({
      target: agentConfigs.userId,
      set: { updatedAt: new Date() },
    })
    .returning();

  return Response.json(toResponse(inserted[0]));
}

export async function PATCH(req: Request) {
  const session = await getSessionInfo(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  const patch = parsed.data;
  const setFields: Partial<typeof agentConfigs.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (patch.enabledSkills !== undefined) setFields.enabledSkills = patch.enabledSkills;
  if (patch.attachedMcps !== undefined) setFields.attachedMcps = patch.attachedMcps;
  if (patch.modelPreference !== undefined) setFields.modelPreference = patch.modelPreference;
  if (patch.approvalRules !== undefined) setFields.approvalRules = patch.approvalRules;

  // Permissions live inside settingsJson.permissions — merge over existing
  // settingsJson rather than overwriting it.
  if (patch.permissions !== undefined) {
    const existingRows = await db
      .select({ settingsJson: agentConfigs.settingsJson })
      .from(agentConfigs)
      .where(eq(agentConfigs.userId, session.userId))
      .limit(1);
    const existing = (existingRows[0]?.settingsJson ?? {}) as Record<string, unknown>;
    setFields.settingsJson = { ...existing, permissions: patch.permissions };
  }

  const updated = await db
    .update(agentConfigs)
    .set(setFields)
    .where(eq(agentConfigs.userId, session.userId))
    .returning();

  const config = updated[0];

  // Fire-and-forget downstream sync
  const downstreamUrl = process.env.AGENTS_URL;
  if (downstreamUrl) {
    const bodyText = JSON.stringify({ user_id: session.userId, ...patch });
    try {
      const { headers } = signRequest({
        method: "POST",
        path: "/agents/km/config",
        body: bodyText,
        userId: session.userId,
        llmKey: "",
      });
      await fetch(`${downstreamUrl}/agents/km/config`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: bodyText,
      });
    } catch (err) {
      console.error("agents/km/config: downstream sync failed", err);
    }
  }

  return Response.json(toResponse(config));
}

function toResponse(row: typeof agentConfigs.$inferSelect) {
  const settingsJson = (row.settingsJson ?? {}) as { permissions?: Record<string, boolean> };
  return {
    enabledSkills: row.enabledSkills,
    attachedMcps: row.attachedMcps,
    modelPreference: row.modelPreference,
    approvalRules: row.approvalRules,
    permissions: settingsJson.permissions ?? { web_search: false },
  };
}
