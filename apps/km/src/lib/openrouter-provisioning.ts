// GSD-126 P0 — OpenRouter Provisioning API wrapper.
//
// Operations against https://openrouter.ai/api/v1/keys:
//   • createUserBucket(userId) → POST  : mint a $5 one-time runtime key
//   • getUserBucketUsage(hash) → GET   : OR-reported usage + limit
//   • patchUserBucket(hash, ...) → PATCH: raise/lower limit, change cadence
//   • deleteUserBucket(hash) → DELETE  : revoke a runtime key (GSD-140 tier swap)
//
// Auth = process.env.OPENROUTER_PROVISIONING_KEY (org-level, NEVER used for
// completions — only /api/v1/keys/* operations). Direct `fetch` so we don't
// take a dep on @openrouter/sdk; the API surface is tiny.
//
// Failure mode: throws on missing env, network error, or non-OK status.
// Provisioning is platform-critical — no silent fallback to env key.

const OR_BASE = "https://openrouter.ai/api/v1/keys";
const ENV_VAR = "OPENROUTER_PROVISIONING_KEY";

export interface CreateUserBucketResult {
  /** Runtime key — only returned once by OR. Encrypt + store immediately. */
  key: string;
  /** Stable identifier for later GET/PATCH calls. */
  hash: string;
}

export interface UserBucketUsage {
  usageUsd: number;
  limitUsd: number;
}

export interface PatchUserBucketInput {
  limit?: number;
  limit_reset?: "daily" | "weekly" | "monthly" | null;
}

function getProvisioningKey(): string {
  const key = process.env[ENV_VAR];
  if (!key) {
    throw new Error(
      `${ENV_VAR} is not set — cannot reach OpenRouter Provisioning API`,
    );
  }
  return key;
}

async function readErrorText(resp: Response): Promise<string> {
  // Cap body read so a hostile/garbled error response can't OOM us. We
  // never echo this back to the client; it's for server logs only.
  try {
    const text = await resp.text();
    return text.slice(0, 500);
  } catch {
    return "<unreadable>";
  }
}

export interface NewBucketConfig {
  /** USD spend cap (OR `limit`). */
  limit: number;
  /** OR `label` for the key. */
  label: string;
  /** OR `limit_reset` cadence; null = one-time bucket. */
  limitReset: "daily" | "weekly" | "monthly" | null;
}

async function postBucket(
  userId: string,
  config: NewBucketConfig,
): Promise<CreateUserBucketResult> {
  const provKey = getProvisioningKey();
  const resp = await fetch(OR_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `episteme-${userId}`,
      label: config.label,
      limit: config.limit,
      limit_reset: config.limitReset,
      include_byok_in_limit: false,
    }),
  });

  if (!resp.ok) {
    const detail = await readErrorText(resp);
    throw new Error(
      `OpenRouter createUserBucket failed: ${resp.status} ${detail}`,
    );
  }

  const json = (await resp.json().catch(() => null)) as
    | {
        key?: string;
        hash?: string;
        data?: { key?: string; hash?: string };
      }
    | null;
  // OR has shipped both flat and `data`-wrapped shapes across versions; cover both.
  const key = json?.key ?? json?.data?.key;
  const hash = json?.hash ?? json?.data?.hash;
  if (!key || !hash) {
    throw new Error("OpenRouter createUserBucket: missing key/hash in response");
  }
  return { key, hash };
}

export async function createUserBucket(
  userId: string,
): Promise<CreateUserBucketResult> {
  // P0 trial bucket: one-time $5, no reset.
  return postBucket(userId, { limit: 5, label: "trial", limitReset: null });
}

/** Mint a fresh bucket with an explicit limit/label/reset (GSD-140 tier swap). */
export async function createUserBucketWithConfig(
  userId: string,
  config: NewBucketConfig,
): Promise<CreateUserBucketResult> {
  return postBucket(userId, config);
}

/** Revoke a runtime key. DELETE /api/v1/keys/{hash}. Throws on non-OK. */
export async function deleteUserBucket(hash: string): Promise<void> {
  const provKey = getProvisioningKey();
  const resp = await fetch(`${OR_BASE}/${hash}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${provKey}` },
  });
  if (!resp.ok) {
    const detail = await readErrorText(resp);
    throw new Error(
      `OpenRouter deleteUserBucket failed: ${resp.status} ${detail}`,
    );
  }
}

export async function getUserBucketUsage(
  hash: string,
): Promise<UserBucketUsage> {
  const provKey = getProvisioningKey();
  const resp = await fetch(`${OR_BASE}/${hash}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${provKey}` },
  });
  if (!resp.ok) {
    const detail = await readErrorText(resp);
    throw new Error(
      `OpenRouter getUserBucketUsage failed: ${resp.status} ${detail}`,
    );
  }
  const json = (await resp.json().catch(() => null)) as
    | {
        usage?: number;
        limit?: number;
        data?: { usage?: number; limit?: number };
      }
    | null;
  const usageUsd = json?.usage ?? json?.data?.usage ?? 0;
  const limitUsd = json?.limit ?? json?.data?.limit ?? 0;
  return { usageUsd: Number(usageUsd), limitUsd: Number(limitUsd) };
}

export async function patchUserBucket(
  hash: string,
  patch: PatchUserBucketInput,
): Promise<void> {
  const provKey = getProvisioningKey();
  const resp = await fetch(`${OR_BASE}/${hash}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${provKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
  if (!resp.ok) {
    const detail = await readErrorText(resp);
    throw new Error(
      `OpenRouter patchUserBucket failed: ${resp.status} ${detail}`,
    );
  }
}
