// Server-side signup wrapper around better-auth's signUpEmail.
//
// Why a wrapper (not `additionalFields` config): we need transactional
// coupling with the `invite_codes` allowlist — refuse signup if the invite
// is missing/used, and atomically stamp the invite row on success.
// better-auth's plugin surface can't express that policy cleanly.
//
// Flow:
//   1. Validate payload (zod).
//   2. Lookup invite_code; reject if missing or already used.
//   3. Call auth.api.signUpEmail with firstname-as-name so seedRealUser
//      (fired inside the user.create.after hook) derives the correct
//      "{firstname}'s Library" label on its first pass.
//   4. UPDATE user row with the rest of the extras (username, user_type,
//      pokemon, invite_code, firstname column).
//   5. UPDATE invite_codes to stamp used_by_user_id + used_at.
//      If the stamp finds 0 rows (concurrent redemption race), roll back by
//      deleting the just-created user and return invite_invalid.
//
// Returns headers (for set-cookie) on success; never throws — caller maps
// SignupResult.error to an HTTP status.
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { inviteCodes, user } from "@episteme/db/schema";
import { auth } from "@/lib/auth-wired";

export const signupExtrasSchema = z.object({
  firstname: z.string().min(1).max(80).trim(),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-z0-9_-]+$/, "username must be lowercase a-z0-9_-"),
  userType: z.enum(["student", "researcher", "industry", "other"]),
  pokemon: z.enum(["charmander", "squirtle", "bulbasaur"]),
  inviteCode: z.string().min(1).max(64).trim(),
});

export type SignupExtrasInput = z.infer<typeof signupExtrasSchema>;

export type SignupResult =
  | { ok: true; userId: string; headers: Headers }
  | { ok: false; error: SignupError; issues?: z.core.$ZodIssue[] };

export type SignupError =
  | "validation"
  | "invite_invalid"
  | "email_taken"
  | "username_taken"
  | "internal";

export async function signupRealUser(
  raw: unknown,
): Promise<SignupResult> {
  const parsed = signupExtrasSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "validation", issues: parsed.error.issues };
  }
  const input = parsed.data;

  // Pre-check invite. Cheaper than failing partway through better-auth's
  // multi-step insert, and lets us give a precise error before any state
  // changes. We re-check atomically during stamping so a concurrent
  // redeemer can't sneak past this gate.
  const [invite] = await db
    .select({ code: inviteCodes.code, usedBy: inviteCodes.usedByUserId })
    .from(inviteCodes)
    .where(eq(inviteCodes.code, input.inviteCode))
    .limit(1);
  if (!invite || invite.usedBy) {
    return { ok: false, error: "invite_invalid" };
  }

  // Optional cheap username pre-check — lets us return a specific error
  // instead of better-auth's generic 422. Race-safe path is still the
  // UNIQUE index on user.username (caught below).
  const [usernameClash] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.username, input.username))
    .limit(1);
  if (usernameClash) return { ok: false, error: "username_taken" };

  // Call better-auth. Pass firstname as `name` so seedRealUser (fires inside
  // user.create.after) sees the correct first-token immediately.
  let signupResp: { user: { id: string } };
  let headers: Headers;
  try {
    const r = await auth.api.signUpEmail({
      body: {
        email: input.email,
        password: input.password,
        name: input.firstname,
      },
      returnHeaders: true,
    });
    headers = r.headers;
    signupResp = r.response as { user: { id: string } };
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    if (msg.includes("email") && (msg.includes("exist") || msg.includes("taken"))) {
      return { ok: false, error: "email_taken" };
    }
    console.error("[signup-real] signUpEmail failed", err);
    return { ok: false, error: "internal" };
  }

  const userId = signupResp.user.id;

  try {
    // Set username + extras + firstname column. Username UPDATE may race
    // with a parallel signup — catch unique-violation and surface taken.
    await db
      .update(user)
      .set({
        username: input.username,
        firstname: input.firstname,
        userType: input.userType,
        pokemon: input.pokemon,
        inviteCode: input.inviteCode,
      })
      .where(eq(user.id, userId));

    // Atomic invite-stamp: only updates if still unused. Returning rowCount
    // lets us detect the lost race.
    const stamped = await db
      .update(inviteCodes)
      .set({ usedByUserId: userId, usedAt: sql`now()` })
      .where(
        and(
          eq(inviteCodes.code, input.inviteCode),
          isNull(inviteCodes.usedByUserId),
        ),
      )
      .returning({ code: inviteCodes.code });

    if (stamped.length === 0) {
      // Lost the race. Undo the user we just created so the invite stays
      // the only source of truth and the email is freed up.
      await db.delete(user).where(eq(user.id, userId));
      return { ok: false, error: "invite_invalid" };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Drizzle/pg duplicate key. We pre-checked but a concurrent signup may
    // have claimed the username between our SELECT and UPDATE.
    if (msg.includes("user_username_unique") || msg.includes("username")) {
      await db.delete(user).where(eq(user.id, userId));
      return { ok: false, error: "username_taken" };
    }
    console.error("[signup-real] post-signup update failed", err);
    await db.delete(user).where(eq(user.id, userId));
    return { ok: false, error: "internal" };
  }

  return { ok: true, userId, headers };
}
