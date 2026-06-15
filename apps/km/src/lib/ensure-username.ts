// GSD-46 — defensive backfill so the referrals page never dead-ends on a
// missing username. Real signups go through signupRealUser which sets one
// explicitly; this helper exists for accounts created outside that path
// (legacy rows, direct better-auth signUpEmail in tests, etc).
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { user } from "@episteme/db/schema";
import { deriveUsernameBase, isValidUsername } from "@/lib/username";

const MAX_SUFFIX_ATTEMPTS = 6;

/**
 * Returns the user's username, claiming a derived one if the row currently has
 * NULL. Collision-safe via the UNIQUE index — adds numeric suffixes until the
 * UPDATE succeeds. Concurrent callers converge on whichever value lands first.
 */
export async function ensureUsername(
  userId: string,
  seed: { name?: string | null; email?: string | null } = {},
): Promise<string | null> {
  const [row] = await db
    .select({ username: user.username, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!row) return null;
  if (row.username) return row.username;

  const base = deriveUsernameBase({
    name: seed.name ?? row.name,
    email: seed.email ?? row.email,
    userId,
  });

  for (let attempt = 0; attempt < MAX_SUFFIX_ATTEMPTS; attempt++) {
    const candidate = attempt === 0 ? base : suffixed(base, attempt);
    if (!isValidUsername(candidate)) continue;
    const claimed = await tryClaim(userId, candidate);
    if (claimed) return claimed;
  }

  // Last-resort: short random suffix. UNIQUE index still protects us; if even
  // this collides we give up — caller renders without referral codes.
  const random = suffixed(base, Math.floor(Math.random() * 1_000_000));
  if (isValidUsername(random)) {
    const claimed = await tryClaim(userId, random);
    if (claimed) return claimed;
  }
  return null;
}

function suffixed(base: string, n: number): string {
  const suffix = `-${n}`;
  const room = 30 - suffix.length;
  return `${base.slice(0, room)}${suffix}`;
}

/**
 * Returns the username actually persisted on the row, or null if the candidate
 * wasn't claimable (collision — caller should try the next suffix).
 */
async function tryClaim(
  userId: string,
  candidate: string,
): Promise<string | null> {
  try {
    // Only claim if still NULL — avoids stomping a value another request just
    // wrote, and lets concurrent callers converge.
    const updated = await db
      .update(user)
      .set({ username: candidate })
      .where(and(eq(user.id, userId), isNull(user.username)))
      .returning({ username: user.username });
    if (updated.length > 0 && updated[0].username) return updated[0].username;

    // 0 rows updated → either (a) row already has a username from a
    // concurrent claim, or (b) row vanished. Refetch and use whatever is
    // there, so callers don't lie about which slug was persisted.
    const [refetched] = await db
      .select({ username: user.username })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    return refetched?.username ?? null;
  } catch (err) {
    const code =
      (err as { code?: string })?.code ??
      (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") {
      // UNIQUE violation on user_username_unique — try next suffix.
      return null;
    }
    throw err;
  }
}

