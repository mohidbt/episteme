// G17 — AI metadata fill endpoint.
// Calls OpenRouter directly with the user's stored BYOK key.
// Returns suggested values for the requested missing fields; the client
// shows a preview and the user accepts/rejects (no auto-apply).
import { z } from "zod";
import { getDecryptedApiKey } from "@episteme/auth/byok";
import { getSessionInfo } from "@/lib/auth";
import {
  OPENROUTER_KEY_MISSING,
  mapOpenRouterStatus,
} from "@/lib/openrouter-errors";

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

  let llmKey: string;
  try {
    llmKey = await getDecryptedApiKey(session.userId);
  } catch {
    return Response.json({ error: OPENROUTER_KEY_MISSING }, { status: 400 });
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
    const keyErr = mapOpenRouterStatus(upstream.status);
    if (keyErr) {
      return Response.json({ error: keyErr }, { status: 401 });
    }
    return Response.json({ error: "upstream_error" }, { status: 502 });
  }

  const data = (await upstream.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: string } }> }
    | null;
  const content = data?.choices?.[0]?.message?.content ?? "";
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
