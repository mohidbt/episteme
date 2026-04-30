import { eq } from "drizzle-orm";
import { getDecryptedApiKey } from "@episteme/auth/byok";
import { getSessionInfo } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentConfigs } from "@episteme/db/schema";
import { signRequest } from "@/lib/agents/sign-request";
import { streamPassthrough } from "@/lib/agents/stream-passthrough";
import { OPENROUTER_KEY_MISSING } from "@/lib/openrouter-errors";

export async function POST(req: Request) {
  const session = await getSessionInfo(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  let llmKey: string;
  try {
    llmKey = await getDecryptedApiKey(session.userId);
  } catch {
    return Response.json({ error: OPENROUTER_KEY_MISSING }, { status: 400 });
  }

  const bodyText = await req.text();

  // Mirror /invoke: pass modelPreference + enabledSkills from Postgres so
  // resume turns also use the real model and SkillsMiddleware stays wired.
  let modelPreference: string | null = null;
  let enabledSkills: string[] | null = null;
  let permissions: Record<string, boolean> | null = null;
  try {
    const rows = await db
      .select({
        modelPreference: agentConfigs.modelPreference,
        enabledSkills: agentConfigs.enabledSkills,
        settingsJson: agentConfigs.settingsJson,
      })
      .from(agentConfigs)
      .where(eq(agentConfigs.userId, session.userId))
      .limit(1);
    modelPreference = rows[0]?.modelPreference ?? null;
    enabledSkills = rows[0]?.enabledSkills ?? null;
    const settings = (rows[0]?.settingsJson ?? {}) as {
      permissions?: Record<string, boolean>;
    };
    permissions = settings.permissions ?? null;
  } catch (err) {
    console.warn("[resume] agentConfigs lookup failed", err);
  }

  const upstreamBody = JSON.stringify({
    ...JSON.parse(bodyText),
    ...(modelPreference ? { model_preference: modelPreference } : {}),
    ...(Array.isArray(enabledSkills) ? { enabled_skills: enabledSkills } : {}),
    ...(permissions ? { permissions } : {}),
  });

  const path = "/agents/km/resume";
  const { headers } = signRequest({
    method: "POST",
    path,
    body: upstreamBody,
    userId: session.userId,
    llmKey,
  });

  const upstream = await fetch(`${process.env.AGENTS_URL}${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: upstreamBody,
  });

  return streamPassthrough(upstream);
}
