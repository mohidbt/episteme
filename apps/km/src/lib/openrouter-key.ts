// Resolve the OpenRouter API key for an outgoing call.
//
// Preference order:
//   1. Signed-in user's BYOK row (user_api_keys.providerType='llm') via
//      @episteme/auth/byok#getDecryptedApiKey. NO_LLM_KEY error → step 2.
//   2. Server-side fallback env OPENROUTER_API_KEY (used for guests +
//      signed-in users without BYOK).
//   3. Neither available → throw OpenRouterKeyMissing.
//
// Guests (userId === null) skip step 1 entirely — there is no BYOK to look up.
//
// Callers must NEVER pass the resolved key back to the client; this is a
// server-only helper.

import { getDecryptedApiKey } from "@episteme/auth/byok";

export class OpenRouterKeyMissing extends Error {
  constructor() {
    super("OpenRouterKeyMissing");
    this.name = "OpenRouterKeyMissing";
  }
}

export async function getOrApiKey(userId: string | null): Promise<string> {
  if (userId) {
    try {
      return await getDecryptedApiKey(userId);
    } catch (err) {
      // Only the "no BYOK row" case should fall through to env fallback.
      // DB connectivity or decrypt errors must NOT silently degrade to env
      // — they indicate a real problem the caller should know about.
      // (Codex Round C RISK follow-up.)
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== "NO_LLM_KEY") throw err;
    }
  }
  const envKey = process.env.OPENROUTER_API_KEY;
  if (envKey) return envKey;
  throw new OpenRouterKeyMissing();
}
