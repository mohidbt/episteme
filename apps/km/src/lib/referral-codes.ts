// GSD-46 — per-user referral code helpers.
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { user, userInviteCodes } from "@episteme/db/schema";

export const REFERRAL_CODES_PER_USER = 5;

export function generateReferralCodes(username: string): string[] {
  const slug = username.trim().toLowerCase();
  if (!slug) throw new Error("username required");
  return Array.from(
    { length: REFERRAL_CODES_PER_USER },
    (_, i) => `episteme-${slug}-${i + 1}`,
  );
}

/**
 * Idempotent: inserts the 5 codes for the user if not already present.
 * Safe to call multiple times (e.g. retried hook) — relies on PK conflict.
 */
export async function ensureUserReferralCodes(
  userId: string,
  username: string,
): Promise<void> {
  const codes = generateReferralCodes(username);
  await db
    .insert(userInviteCodes)
    .values(codes.map((code) => ({ code, ownerUserId: userId })))
    .onConflictDoNothing({ target: userInviteCodes.code });
}

export type ReferralCodeRow = {
  code: string;
  consumedByUserId: string | null;
  consumedAt: Date | null;
  consumedByUsername: string | null;
};

export async function listReferralCodesForUser(
  userId: string,
): Promise<ReferralCodeRow[]> {
  return db
    .select({
      code: userInviteCodes.code,
      consumedByUserId: userInviteCodes.consumedByUserId,
      consumedAt: userInviteCodes.consumedAt,
      consumedByUsername: user.username,
    })
    .from(userInviteCodes)
    .leftJoin(user, eq(user.id, userInviteCodes.consumedByUserId))
    .where(eq(userInviteCodes.ownerUserId, userId))
    .orderBy(userInviteCodes.code);
}

/**
 * Look up a user referral code. Returns null if not found OR already consumed.
 */
export async function lookupUserReferralCode(code: string): Promise<{
  code: string;
  ownerUserId: string;
} | null> {
  const [row] = await db
    .select({
      code: userInviteCodes.code,
      ownerUserId: userInviteCodes.ownerUserId,
      consumedByUserId: userInviteCodes.consumedByUserId,
    })
    .from(userInviteCodes)
    .where(eq(userInviteCodes.code, code))
    .limit(1);
  if (!row || row.consumedByUserId) return null;
  return { code: row.code, ownerUserId: row.ownerUserId };
}

/**
 * Atomic stamp — sets consumed_by + consumed_at only if still unused.
 * Returns true on success, false if already consumed (race lost).
 */
export async function stampUserReferralCode(
  code: string,
  consumerUserId: string,
): Promise<boolean> {
  const stamped = await db
    .update(userInviteCodes)
    .set({ consumedByUserId: consumerUserId, consumedAt: sql`now()` })
    .where(
      and(
        eq(userInviteCodes.code, code),
        isNull(userInviteCodes.consumedByUserId),
      ),
    )
    .returning({ code: userInviteCodes.code });
  return stamped.length > 0;
}
