// GSD-140 — retry-once wrapper around the OR key resolver.
//
// During a tier swap (replaceUserBucket: DELETE old key + POST new) there's a
// brief window where an in-flight request can carry the just-deleted key and
// get a 401/402 from OpenRouter. This wrapper absorbs that single transient
// failure: it re-resolves the key (a fresh DB read picks up the newly-persisted
// key) and retries the attempt EXACTLY once. Non-transient errors pass through
// unretried; a second transient failure is re-thrown (no loop).
//
// Callsites that opt in throw OrKeyTransientError when an OR completion returns
// 401 or 402 on a managed bucket.

import { getOrApiKey } from "./openrouter-key";

export class OrKeyTransientError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`OrKeyTransientError(${status})`);
    this.name = "OrKeyTransientError";
    this.status = status;
  }
}

export async function withOrKeyRetry<T>(
  userId: string | null,
  attempt: (key: string) => Promise<T>,
): Promise<T> {
  const key = await getOrApiKey(userId);
  try {
    return await attempt(key);
  } catch (err) {
    if (!(err instanceof OrKeyTransientError)) throw err;
    // Single bounded retry: re-resolve (fresh row read) + one more attempt.
    const fresh = await getOrApiKey(userId);
    return await attempt(fresh);
  }
}
