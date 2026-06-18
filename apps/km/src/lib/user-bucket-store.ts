// GSD-126 P0 — DB helpers for the user_openrouter_keys table.
//
// Kept as a thin layer so the resolver test can mock these without
// dragging in the whole drizzle stack. Encryption + decryption uses
// the same AES-256-GCM helper that secures BYOK rows.

import { db } from "@/lib/db";
import { userOpenrouterKeys } from "@episteme/db/schema";
import { eq } from "drizzle-orm";
// `encrypt`/`decrypt` are AES-256-GCM helpers that secure BYOK rows too;
// reusing them keeps the storage format consistent with user_api_keys.
// Pulled from the encryption module directly (not the barrel) so we don't
// drag the client-side better-auth bundle into a server module.
import { decrypt, encrypt } from "@episteme/auth/encryption";

export interface LoadedBucket {
  runtimeKey: string;
  hash: string;
}

/** Look up a user's managed OR bucket. Returns null when absent. */
export async function loadUserBucket(
  userId: string,
): Promise<LoadedBucket | null> {
  const rows = await db
    .select({
      orKeyEncrypted: userOpenrouterKeys.orKeyEncrypted,
      orKeyHash: userOpenrouterKeys.orKeyHash,
    })
    .from(userOpenrouterKeys)
    .where(eq(userOpenrouterKeys.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    runtimeKey: decrypt(row.orKeyEncrypted),
    hash: row.orKeyHash,
  };
}

export interface InsertBucketInput {
  userId: string;
  runtimeKey: string;
  hash: string;
}

/**
 * Race-safe INSERT for the lazy-provision path. Returns true when our
 * row landed, false when a concurrent caller already inserted (in which
 * case the caller should re-read via loadUserBucket).
 */
export async function insertUserBucketIfMissing(
  input: InsertBucketInput,
): Promise<boolean> {
  const encrypted = encrypt(input.runtimeKey);
  const result = await db
    .insert(userOpenrouterKeys)
    .values({
      userId: input.userId,
      orKeyHash: input.hash,
      orKeyEncrypted: encrypted,
    })
    .onConflictDoNothing({ target: userOpenrouterKeys.userId })
    .returning({ userId: userOpenrouterKeys.userId });
  return result.length > 0;
}
