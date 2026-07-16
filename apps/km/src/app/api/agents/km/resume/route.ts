import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  getOrApiKey,
  OpenRouterKeyMissing,
  OpenRouterTrialExhausted,
} from "@/lib/openrouter-key";
import { getSessionInfo } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentConfigs } from "@episteme/db/schema";
import { signRequest } from "@/lib/agents/sign-request";
import { streamPassthrough } from "@/lib/agents/stream-passthrough";
import { tapAgentEvents } from "@/lib/agents/thread-lifecycle";
import { OPENROUTER_KEY_MISSING } from "@/lib/openrouter-errors";
import { recordUsage } from "@/lib/openrouter-usage";

const MAX_AGENT_BODY_BYTES = 256 * 1024;
const ResumeBody = z
  .object({
    thread_id: z.string().min(1).max(255),
    decisions: z.array(z.unknown()).max(100).default([]),
    skill: z.string().min(1).max(255).nullable().optional(),
  })
  .strict();

export async function POST(req: Request) {
  const session = await getSessionInfo(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  // Resume decisions are client-owned. Agent configuration and approval
  // policy are not: reject unknown keys so a browser cannot replace the
  // server-side permissions/approval_rules sent below.
  const bodyText = await req.text();
  if (Buffer.byteLength(bodyText, "utf8") > MAX_AGENT_BODY_BYTES) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  let parsedBody: z.infer<typeof ResumeBody>;
  try {
    parsedBody = ResumeBody.parse(JSON.parse(bodyText));
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  // GSD-132: BYOK → managed bucket → env. Anonymous sessions skip the
  // managed lookup (no FK). Pre-stream 402 emit if the resolver itself
  // throws TrialExhausted; the upstream 402 mapping below covers mid-stream
  // bucket drain via streamPassthrough.
  let llmKey: string;
  try {
    llmKey = await getOrApiKey(session.isAnonymous ? null : session.userId);
  } catch (err) {
    if (err instanceof OpenRouterTrialExhausted) {
      return Response.json({ error: "trial_exhausted" }, { status: 402 });
    }
    if (err instanceof OpenRouterKeyMissing) {
      return Response.json({ error: OPENROUTER_KEY_MISSING }, { status: 400 });
    }
    throw err;
  }
  // Mirror /invoke: pass modelPreference + enabledSkills + approvalRules +
  // permissions from Postgres so the agent-side `build_km_agent` rebuild on
  // resume re-applies the same gates the initial /invoke did. Without this,
  // the agent falls back to its in-process cache (cold after restart →
  // user-saved approval rules silently dropped on the post-approval
  // continuation turn). GSD-103.
  let modelPreference: string | null = null;
  let enabledSkills: string[] | null = null;
  let permissions: Record<string, boolean> | null = null;
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
      .where(eq(agentConfigs.userId, session.userId))
      .limit(1);
    modelPreference = rows[0]?.modelPreference ?? null;
    enabledSkills = rows[0]?.enabledSkills ?? null;
    approvalRules =
      (rows[0]?.approvalRules as Record<string, unknown>) ?? null;
    const settings = (rows[0]?.settingsJson ?? {}) as {
      permissions?: Record<string, boolean>;
    };
    permissions = settings.permissions ?? null;
  } catch (err) {
    console.warn("[resume] agentConfigs lookup failed", err);
  }

  // Mirror /invoke's skill-hint merge: a `body.skill` from the client (e.g.
  // the Agentic Search button) must land in `enabled_skills` so the
  // resumed turn loads the same skill workflow + tool allow-list as the
  // initial /invoke. Without this, post-approval continuation rebuilt
  // without paper-search → pruned tools → runtime mismatch.
  const skillHint: string | undefined = parsedBody.skill ?? undefined;
  let mergedSkills: string[] | null = enabledSkills ? [...enabledSkills] : null;
  if (skillHint) {
    mergedSkills ??= [];
    if (!mergedSkills.includes(skillHint)) mergedSkills.push(skillHint);
  }

  const upstreamBody = JSON.stringify({
    thread_id: parsedBody.thread_id,
    decisions: parsedBody.decisions,
    ...(parsedBody.skill ? { skill: parsedBody.skill } : {}),
    ...(modelPreference ? { model_preference: modelPreference } : {}),
    ...(Array.isArray(mergedSkills) ? { enabled_skills: mergedSkills } : {}),
    ...(permissions ? { permissions } : {}),
    ...(approvalRules ? { approval_rules: approvalRules } : {}),
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

  if (!upstream.ok || !upstream.body) {
    return streamPassthrough(upstream);
  }
  // Resume turns still drive LLM calls (post-HITL approvals continue the
  // graph), so they must record usage. No status callback — /invoke already
  // initialised the thread row; the tap only siphons usage frames.
  const tapped = tapAgentEvents(upstream.body, () => {}, (u) => {
    void recordUsage({
      userId: session.userId,
      guestSessionId: null,
      model: u.model,
      promptTokens: u.promptTokens,
      completionTokens: u.completionTokens,
      source: "km-agent",
    }).catch((err) => {
      console.warn("[resume] recordUsage failed", err);
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
