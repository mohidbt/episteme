// G17 — AI metadata fill endpoint.
// Calls OpenRouter directly with the user's stored BYOK key.
// Returns suggested values for the requested missing fields; the client
// shows a preview and the user accepts/rejects (no auto-apply).
import { z } from "zod";
import { getSessionInfo } from "@/lib/auth";
import {
  OPENROUTER_KEY_MISSING,
  mapOpenRouterStatus,
} from "@/lib/openrouter-errors";
import { getOrApiKey, OpenRouterKeyMissing } from "@/lib/openrouter-key";
import { recordUsage } from "@/lib/openrouter-usage";
import { checkOpenRouterFallbackResponse } from "@/lib/key-health";

const MODEL = "openai/gpt-5.4-nano";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const bodySchema = z.object({
  kind: z.enum(["paper", "reference"]),
  known: z.record(z.string(), z.unknown()),
  missing: z.array(z.string()).min(1, "missing must list at least one field"),
});

function buildPrompt(
  kind: "paper" | "reference",
  known: Record<string, unknown>,
  missing: string[],
): string {
  return [
    `You are filling in missing bibliographic metadata for a ${kind}.`,
    `Known fields:\n${JSON.stringify(known, null, 2)}`,
    `Suggest ONLY the following missing fields: ${missing.join(", ")}.`,
    `Respond with a single JSON object whose keys are the missing field names.`,
    `If you cannot determine a value with reasonable confidence, omit that key.`,
    `Year must be an integer. Authors must be an array of strings.`,
    `Do not include any prose outside the JSON object.`,
  ].join("\n\n");
}

export async function POST(req: Request): Promise<Response> {
  const session = await getSessionInfo(req);
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { kind, known, missing } = parsed.data;

  // Round C: BYOK first, then server env fallback (also covers anonymous
  // users — they hit ai-fill via the same route once they're past auth).
  let llmKey: string;
  try {
    llmKey = await getOrApiKey(session.userId);
  } catch (err) {
    if (err instanceof OpenRouterKeyMissing) {
      return Response.json({ error: OPENROUTER_KEY_MISSING }, { status: 400 });
    }
    throw err;
  }

  let upstream: Response;
  try {
    upstream = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${llmKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: "Reply with strict JSON only." },
          { role: "user", content: buildPrompt(kind, known, missing) },
        ],
        response_format: { type: "json_object" },
      }),
    });
  } catch {
    return Response.json({ error: "upstream_unavailable" }, { status: 502 });
  }

  if (!upstream.ok) {
    checkOpenRouterFallbackResponse({
      envVar: "OPENROUTER_API_KEY",
      apiKey: llmKey,
      response: upstream,
    });
    const keyErr = mapOpenRouterStatus(upstream.status);
    if (keyErr) {
      return Response.json({ error: keyErr }, { status: 401 });
    }
    return Response.json({ error: "upstream_error" }, { status: 502 });
  }

  const data = (await upstream.json().catch(() => null)) as
    | {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      }
    | null;
  const content = data?.choices?.[0]?.message?.content ?? "";

  // Round C: best-effort usage capture. Identity rule: signed-in → user_id,
  // anonymous → guest_session_id (using the anon user id as a stable session
  // key). Failures here must NOT break the response — the user's metadata
  // suggestion is the product, the audit row is bookkeeping.
  const usage = data?.usage;
  if (usage && (usage.prompt_tokens || usage.completion_tokens)) {
    const userIdForRow = session.isAnonymous ? null : session.userId;
    const guestIdForRow = session.isAnonymous ? session.userId : null;
    void recordUsage({
      userId: userIdForRow,
      guestSessionId: guestIdForRow,
      model: MODEL,
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      source: "ai-fill",
    }).catch((err) => {
      console.warn("[ai-fill] recordUsage failed", err);
    });
  }
  let suggestions: Record<string, unknown>;
  try {
    suggestions = JSON.parse(content);
  } catch {
    return Response.json({ error: "invalid_llm_response" }, { status: 502 });
  }

  // Filter to only requested fields.
  const filtered: Record<string, unknown> = {};
  for (const k of missing) {
    if (k in suggestions && suggestions[k] !== null && suggestions[k] !== "") {
      filtered[k] = suggestions[k];
    }
  }

  return Response.json({ suggestions: filtered });
}
