// Server-only helper: extract a paper's DOI from its first page text using
// a tiny OpenRouter call (openai/gpt-5-nano). Used by the citations/extract
// route to enable Semantic Scholar lookup when `papers.doi` is NULL.
//
// Defensive: never throws on transient fetch / LLM errors. Validates the
// model output against a DOI regex before returning. Records usage so the
// per-identity spend audit captures the call.

// Server-side only. Not marked with `server-only` to keep vitest compatibility
// with the rest of `src/lib/*`; the file is only ever imported from route
// handlers.
import { recordUsage } from "@/lib/openrouter-usage";

const MODEL = "openai/gpt-5-nano";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// Crossref DOI suffix is intentionally permissive (RFC 3986 unreserved +
// most punctuation). Match anything non-whitespace after the `10.NNNN/`
// prefix; we already strip trailing punctuation above.
const DOI_RE = /^10\.\d{4,9}\/\S+$/i;

// Trim only the chunk of first-page text we send to the model — the DOI
// almost always appears in the first few hundred characters.
const MAX_INPUT_CHARS = 4000;

const SYSTEM_PROMPT =
  "You extract DOIs from academic paper first pages. " +
  "Respond with ONLY the DOI string (for example: 10.1234/abc.5678) and nothing else. " +
  "If no DOI is present, respond with an empty string.";

export interface ExtractDoiOpts {
  openrouterKey: string;
  /** Identity for usage audit. Pass null for guests. */
  userId: string | null;
  guestSessionId?: string | null;
}

export async function extractDoiFromFirstPage(
  firstPageText: string,
  opts: ExtractDoiOpts,
): Promise<string | null> {
  const trimmed = (firstPageText ?? "").slice(0, MAX_INPUT_CHARS);
  if (!trimmed.trim()) return null;

  let resp: Response;
  try {
    resp = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.openrouterKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: trimmed },
        ],
        temperature: 0,
        max_tokens: 64,
      }),
    });
  } catch (err) {
    console.warn("[extract-doi] fetch failed", err);
    return null;
  }

  if (!resp.ok) {
    console.warn("[extract-doi] non-OK", resp.status);
    return null;
  }

  let body: {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    body = (await resp.json()) as typeof body;
  } catch (err) {
    console.warn("[extract-doi] json parse failed", err);
    return null;
  }

  // Record usage even when validation fails — the call was made.
  try {
    await recordUsage({
      userId: opts.userId,
      guestSessionId: opts.guestSessionId ?? null,
      model: MODEL,
      promptTokens: body.usage?.prompt_tokens ?? 0,
      completionTokens: body.usage?.completion_tokens ?? 0,
      source: "doi-extract",
    });
  } catch (err) {
    console.warn("[extract-doi] recordUsage failed", err);
  }

  const raw = (body.choices?.[0]?.message?.content ?? "").trim();
  if (!raw) return null;

  // Strip common decoration the model might add despite instructions.
  const candidate = raw
    .replace(/^doi:\s*/i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/[.,;)\]]+$/, "")
    .trim();

  return DOI_RE.test(candidate) ? candidate : null;
}
