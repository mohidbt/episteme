// Resolve the OpenRouter API key for an outgoing call.
//
// Preference order (GSD-126 P0):
//   1. Signed-in user's BYOK row (user_api_keys.providerType='llm') via
//      @episteme/auth/byok#getDecryptedApiKey. NO_LLM_KEY → step 2.
//   2. Signed-in user's MANAGED bucket (user_openrouter_keys). If the row
//      is missing, lazy-provision a fresh $5 OR bucket via the Provisioning
//      API + insert (race-safe via ON CONFLICT (user_id) DO NOTHING + re-read).
//   3. Server-side env OPENROUTER_API_KEY — guests only (no userId).
//   4. Neither available → throw OpenRouterKeyMissing.
//
// Guests (userId === null) skip steps 1+2 and go straight to env. The
// managed-bucket path requires a real userId for FK integrity.
//
// 402 from a completions call on a managed bucket → callsite throws
// OpenRouterTrialExhausted (mapped to 402 `trial_exhausted` upstream).
//
// Callers must NEVER pass the resolved key back to the client; this is a
// server-only helper.

import { getDecryptedApiKey } from "@episteme/auth/byok";
import {
  createUserBucket,
} from "./openrouter-provisioning";
import {
  insertUserBucketIfMissing,
  loadUserBucket,
} from "./user-bucket-store";

export class OpenRouterKeyMissing extends Error {
  constructor() {
    super("OpenRouterKeyMissing");
    this.name = "OpenRouterKeyMissing";
  }
}

export class OpenRouterTrialExhausted extends Error {
  constructor() {
    super("OpenRouterTrialExhausted");
    this.name = "OpenRouterTrialExhausted";
  }
}

async function resolveManagedBucket(userId: string): Promise<string | null> {
  // Hot path: bucket already exists. Single SELECT.
  const existing = await loadUserBucket(userId);
  if (existing) return existing.runtimeKey;

  // Cold path: mint a fresh OR bucket, insert with ON CONFLICT DO NOTHING.
  // If a concurrent caller beat us to it, our INSERT returns no rows and we
  // re-read; the winner's encrypted key is the one we hand back. The losing
  // OR-side key is orphaned ($0 burn, GSD-131 owns cleanup). Acceptable
  // for P0 — race window is microseconds on first AI call ever.
  //
  // If provisioning is unconfigured (env var missing during rollout), the
  // helper throws — we surface null so the caller can try env fallback.
  let minted: { key: string; hash: string };
  try {
    minted = await createUserBucket(userId);
  } catch (err) {
    console.warn(
      "[openrouter-key] managed bucket provisioning failed, will try env fallback",
      err,
    );
    return null;
  }
  const inserted = await insertUserBucketIfMissing({
    userId,
    runtimeKey: minted.key,
    hash: minted.hash,
  });
  if (inserted) return minted.key;

  const reread = await loadUserBucket(userId);
  if (reread) return reread.runtimeKey;
  // Should be unreachable: we either inserted, or another tx inserted
  // and we'll re-read it. Defensive throw beats returning the orphan.
  throw new Error(
    "user_openrouter_keys row vanished between conflict and re-read",
  );
}

export async function getOrApiKey(userId: string | null): Promise<string> {
  if (userId) {
    // Step 1: BYOK.
    try {
      return await getDecryptedApiKey(userId);
    } catch (err) {
      // Only the "no BYOK row" case falls through to managed bucket. DB
      // connectivity / decrypt errors surface to the caller (Codex Round C).
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== "NO_LLM_KEY") throw err;
    }

    // Step 2: managed bucket (lazy-provision on miss).
    const managed = await resolveManagedBucket(userId);
    if (managed) return managed;
    // Step 3: env fallback when provisioning is unconfigured (P0 rollout
    // safety — preview/prod won't have OPENROUTER_PROVISIONING_KEY on the
    // first deploy. Once it's set the managed path always wins.)
  }

  const envKey = process.env.OPENROUTER_API_KEY;
  if (envKey) return envKey;
  throw new OpenRouterKeyMissing();
}
