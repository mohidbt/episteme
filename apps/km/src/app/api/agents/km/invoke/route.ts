import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSessionInfo } from "@/lib/auth";
import { getOrApiKey, OpenRouterKeyMissing } from "@/lib/openrouter-key";
import { db } from "@/lib/db";
import { agentConfigs } from "@episteme/db/schema";
import { signRequest } from "@/lib/agents/sign-request";
import { tapAgentEvents } from "@/lib/agents/thread-lifecycle";
import { OPENROUTER_KEY_MISSING } from "@/lib/openrouter-errors";
import { recordUsage } from "@/lib/openrouter-usage";
import {
  updateThread,
  upsertThreadOnInvoke,
  type AgentThreadStatus,
} from "@/lib/threads";
import { deriveThreadTitle } from "@/lib/thread-title";

const InvokeBody = z.object({
  thread_id: z.string().min(1),
  message: z.string().optional(),
  skill: z.string().nullable().optional(),
  model_override: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const session = await getSessionInfo(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  // GSD-126 P0: signed-in users → BYOK → managed bucket; guests → env.
  // Pass null for guests so the resolver skips the managed-bucket path.
  let llmKey: string;
  try {
    llmKey = await getOrApiKey(session.isAnonymous ? null : session.userId);
  } catch (err) {
    if (err instanceof OpenRouterKeyMissing) {
      return Response.json({ error: OPENROUTER_KEY_MISSING }, { status: 400 });
    }
    throw err;
  }
  const bodyText = await req.text();
  let body: z.infer<typeof InvokeBody>;
  try {
    body = InvokeBody.parse(JSON.parse(bodyText));
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  // Identity split for usage accounting: signed-in users get their userId,
  // anonymous sessions get guestSessionId (the anon user id is a stable
  // per-session key). DB-owner-scoped operations below (thread upsert/read)
  // continue to use session.userId so guest threads still have a stable owner.
  const userId = session.userId;
  const usageUserId = session.isAnonymous ? null : session.userId;
  const usageGuestSessionId = session.isAnonymous ? session.userId : null;
  const threadId = body.thread_id;

  // Single-roundtrip UPSERT before kicking off upstream call.
  try {
    await upsertThreadOnInvoke({
      userId,
      threadId,
      skill: body.skill ?? null,
      modelOverride: body.model_override ?? null,
      // Task #41: derive a title from the first user message. INSERT only —
      // upsertThreadOnInvoke leaves the title untouched on conflict, so this
      // is a no-op on existing threads.
      initialTitle: body.message ? deriveThreadTitle(body.message) : null,
    });
  } catch {
    return Response.json({ error: "db_error" }, { status: 500 });
  }

  // Read modelPreference + enabledSkills from Postgres (source of truth) and
  // inject them into the upstream body so Python doesn't trust its in-memory
  // cache, which can be empty after a restart and silently fall back to a
  // free model with no skills wired.
  let modelPreference: string | null = null;
  let enabledSkills: string[] | null = null;
  let permissions: Record<string, boolean> | null = null;
  // GSD-68: approvalRules was never forwarded to the agent service. The
  // Python side defaulted to its in-process cache (empty after restart),
  // so user-saved "require approval on X" had no effect on /invoke.
  let approvalRules: Record<string, unknown> | null = null;
  try {
    const rows = await db
      .select({
        modelPreference: agentConfigs.modelPreference,
        enabledSkills: agentConfigs.enabledSkills,
        approvalRules: agentConfigs.approvalRules,
        settingsJson: agentConfigs.settingsJson,
      })
      .from(agentConfigs)
      .where(eq(agentConfigs.userId, userId))
      .limit(1);
    modelPreference = rows[0]?.modelPreference ?? null;
    enabledSkills = rows[0]?.enabledSkills ?? null;
    approvalRules = (rows[0]?.approvalRules as Record<string, unknown>) ?? null;
    const settings = (rows[0]?.settingsJson ?? {}) as {
      permissions?: Record<string, boolean>;
    };
    permissions = settings.permissions ?? null;
  } catch (err) {
    console.warn("[invoke] agentConfigs lookup failed", err);
  }

  // If the frontend sent a `skill` hint (e.g. "paper-search" from the
  // Agentic Search button), merge it into enabled_skills so the Python
  // agent picks up the skill's workflow instructions and tool allow-list.
  const skillHint: string | undefined = body.skill ?? undefined;
  let mergedSkills: string[] | null = enabledSkills
    ? [...enabledSkills]
    : null;
  if (skillHint) {
    mergedSkills ??= [];
    if (!mergedSkills.includes(skillHint)) mergedSkills.push(skillHint);
  }

  const upstreamBody = JSON.stringify({
    ...JSON.parse(bodyText),
    ...(modelPreference ? { model_preference: modelPreference } : {}),
    ...(Array.isArray(mergedSkills) ? { enabled_skills: mergedSkills } : {}),
    ...(permissions ? { permissions } : {}),
    ...(approvalRules ? { approval_rules: approvalRules } : {}),
  });

  const path = "/agents/km/invoke";
  const { headers } = signRequest({
    method: "POST",
    path,
    body: upstreamBody,
    userId,
    llmKey,
  });

  const upstream = await fetch(`${process.env.AGENTS_URL}${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: upstreamBody,
  });

  const setStatus = (status: AgentThreadStatus) => {
    // Fire-and-forget; never block the byte stream on DB writes.
    void updateThread(userId, threadId, {
      status,
      ...(status === "idle" || status === "error"
        ? { lastMessageAt: new Date() }
        : {}),
    }).catch((err) => {
      console.warn("[invoke] thread status update failed", status, err);
    });
  };

  if (!upstream.ok || !upstream.body) {
    setStatus("error");
    // GSD-126 P0: surface bucket exhaustion as a stable trial_exhausted
    // code so the agent UI can render an upgrade prompt instead of a
    // generic upstream error toast.
    if (upstream.status === 402) {
      return Response.json({ error: "trial_exhausted" }, { status: 402 });
    }
    return new Response(upstream.body, { status: upstream.status });
  }

  const tapped = tapAgentEvents(upstream.body, setStatus, (u) => {
    // Fire-and-forget — recordUsage swallows DB errors via console.warn.
    void recordUsage({
      userId: usageUserId,
      guestSessionId: usageGuestSessionId,
      model: u.model,
      promptTokens: u.promptTokens,
      completionTokens: u.completionTokens,
      source: "km-agent",
    }).catch((err) => {
      console.warn("[invoke] recordUsage failed", err);
    });
  });
  return new Response(tapped, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
