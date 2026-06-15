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
import {
  inviteCodes,
  signupWaitlist,
  user,
  userInviteCodes,
  userSignupProfiles,
} from "@episteme/db/schema";
import { auth } from "@/lib/auth-wired";
import { ensureUserReferralCodes } from "@/lib/referral-codes";
import { isValidUsername } from "@/lib/username";
import { isUniqueViolation } from "@/lib/pg-errors";

// GSD-46 — env gate. Defaults to enforced (matches launch posture: every
// signup needs a code). Set INVITE_ONLY_SIGNUP=false to disable in dev.
function inviteOnlySignupEnabled(): boolean {
  const v = process.env.INVITE_ONLY_SIGNUP;
  if (v === "0" || v === "false") return false;
  return true;
}

type InviteLookup =
  | { kind: "admin"; code: string }
  | { kind: "user"; code: string; ownerUserId: string }
  | null;

async function lookupInvite(code: string): Promise<InviteLookup> {
  const [admin] = await db
    .select({ code: inviteCodes.code, usedBy: inviteCodes.usedByUserId })
    .from(inviteCodes)
    .where(eq(inviteCodes.code, code))
    .limit(1);
  if (admin && !admin.usedBy) return { kind: "admin", code: admin.code };

  const [refer] = await db
    .select({
      code: userInviteCodes.code,
      ownerUserId: userInviteCodes.ownerUserId,
      consumedBy: userInviteCodes.consumedByUserId,
    })
    .from(userInviteCodes)
    .where(eq(userInviteCodes.code, code))
    .limit(1);
  if (refer && !refer.consumedBy) {
    return { kind: "user", code: refer.code, ownerUserId: refer.ownerUserId };
  }
  return null;
}

const USER_TYPES = ["student", "researcher", "industry", "other"] as const;
const POKEMON = ["charmander", "squirtle", "bulbasaur"] as const;
const STUDENT_LEVELS = ["Bachelor", "Master", "PhD"] as const;

const optionalTrimmed = z.string().trim().max(120).optional();

const signupBaseShape = {
  firstname: z.string().min(1).max(80).trim(),
  email: z.string().email(),
  username: z
    .string()
    .refine(isValidUsername, "username must be 3-30 lowercase a-z0-9-, not reserved"),
  userType: z.enum(USER_TYPES),
  pokemon: z.enum(POKEMON),
  studentLevel: z.enum(STUDENT_LEVELS).optional(),
  jobRole: optionalTrimmed,
  industry: optionalTrimmed,
  personaOther: optionalTrimmed,
};

type PersonaInput = {
  userType?: unknown;
  studentLevel?: unknown;
  jobRole?: unknown;
  industry?: unknown;
  personaOther?: unknown;
};

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function addPersonaIssue(ctx: z.core.$RefinementCtx, message: string) {
  ctx.addIssue({ code: "custom", message });
}

function validatePersonaDetails(input: PersonaInput, ctx: z.core.$RefinementCtx) {
  const student = input.studentLevel;
  const job = input.jobRole;
  const industry = input.industry;
  const other = input.personaOther;

  if (input.userType === "student") {
    if (!hasText(student)) addPersonaIssue(ctx, "studentLevel is required");
    if (hasText(job) || hasText(industry) || hasText(other)) {
      addPersonaIssue(ctx, "student persona cannot include non-student details");
    }
  } else if (input.userType === "researcher") {
    if (!hasText(job)) addPersonaIssue(ctx, "jobRole is required");
    if (hasText(student) || hasText(industry) || hasText(other)) {
      addPersonaIssue(ctx, "researcher persona cannot include mismatched details");
    }
  } else if (input.userType === "industry") {
    if (!hasText(job)) addPersonaIssue(ctx, "jobRole is required");
    if (!hasText(industry)) addPersonaIssue(ctx, "industry is required");
    if (hasText(student) || hasText(other)) {
      addPersonaIssue(ctx, "industry persona cannot include mismatched details");
    }
  } else if (input.userType === "other") {
    if (!hasText(other)) addPersonaIssue(ctx, "personaOther is required");
    if (hasText(student) || hasText(job) || hasText(industry)) {
      addPersonaIssue(ctx, "other persona cannot include mismatched details");
    }
  }
}

export const signupExtrasSchema = z
  .object({
    ...signupBaseShape,
    password: z.string().min(8).max(200),
    inviteCode: z.string().min(1).max(64).trim(),
  })
  .strict()
  .superRefine(validatePersonaDetails);

export const inviteValidationSchema = z.string().min(1).max(64).trim();

export const signupWaitlistSchema = z
  .object({
    ...signupBaseShape,
    attemptedInviteCode: z.string().max(64).trim().optional(),
  })
  .strict()
  .superRefine(validatePersonaDetails);

export type SignupExtrasInput = z.infer<typeof signupExtrasSchema>;
export type SignupWaitlistInput = z.infer<typeof signupWaitlistSchema>;

export type SignupResult =
  | { ok: true; userId: string; headers: Headers }
  | { ok: false; error: SignupError; issues?: z.core.$ZodIssue[] };

export type SimpleSignupResult =
  | { ok: true }
  | { ok: false; error: SignupError; issues?: z.core.$ZodIssue[] };

export type SignupError =
  | "validation"
  | "invite_invalid"
  | "email_taken"
  | "username_taken"
  | "internal";

function profileValues(input: PersonaInput) {
  return {
    studentLevel:
      input.userType === "student" ? (input.studentLevel as string) : null,
    jobRole:
      input.userType === "researcher" || input.userType === "industry"
        ? (input.jobRole as string)
        : null,
    industry: input.userType === "industry" ? (input.industry as string) : null,
    personaOther:
      input.userType === "other" ? (input.personaOther as string) : null,
  };
}

export async function validateInviteCode(
  raw: unknown,
): Promise<SimpleSignupResult> {
  const parsed = inviteValidationSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "validation", issues: parsed.error.issues };
  }

  try {
    const found = await lookupInvite(parsed.data);
    if (!found) return { ok: false, error: "invite_invalid" };
    return { ok: true };
  } catch (err) {
    console.error("[signup-real] invite validation failed", err);
    return { ok: false, error: "internal" };
  }
}

export async function saveSignupWaitlistEntry(
  raw: unknown,
): Promise<SimpleSignupResult> {
  const parsed = signupWaitlistSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "validation", issues: parsed.error.issues };
  }
  const input = parsed.data;
  const details = profileValues(input);
  const now = new Date();

  try {
    await db
      .insert(signupWaitlist)
      .values({
        email: input.email,
        firstname: input.firstname,
        username: input.username,
        userType: input.userType,
        pokemon: input.pokemon,
        studentLevel: details.studentLevel,
        jobRole: details.jobRole,
        industry: details.industry,
        personaOther: details.personaOther,
        attemptedInviteCode: input.attemptedInviteCode ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: signupWaitlist.email,
        set: {
          firstname: input.firstname,
          username: input.username,
          userType: input.userType,
          pokemon: input.pokemon,
          studentLevel: details.studentLevel,
          jobRole: details.jobRole,
          industry: details.industry,
          personaOther: details.personaOther,
          attemptedInviteCode: input.attemptedInviteCode ?? null,
          updatedAt: now,
        },
      });
    return { ok: true };
  } catch (err) {
    console.error("[signup-real] waitlist save failed", err);
    return { ok: false, error: "internal" };
  }
}

export async function signupRealUser(
  raw: unknown,
): Promise<SignupResult> {
  const parsed = signupExtrasSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "validation", issues: parsed.error.issues };
  }
  const input = parsed.data;
  const details = profileValues(input);

  // Pre-check invite. Cheaper than failing partway through better-auth's
  // multi-step insert, and lets us give a precise error before any state
  // changes. We re-check atomically during stamping so a concurrent
  // redeemer can't sneak past this gate.
  // GSD-46: when INVITE_ONLY_SIGNUP is disabled, the code is optional and
  // any invalid value still falls through to create the account (matches
  // pre-launch UX). When enabled, an unused code from either the admin
  // allowlist or a per-user referral pool is required.
  const gateEnabled = inviteOnlySignupEnabled();
  const invite = await lookupInvite(input.inviteCode);
  if (gateEnabled && !invite) {
    return { ok: false, error: "invite_invalid" };
  }
  // When the gate is off but the user still sent a (valid) code we honour
  // it so referrals are still tracked. An unknown code in disabled-mode is
  // silently ignored.

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

    await db.insert(userSignupProfiles).values({
      userId,
      studentLevel: details.studentLevel,
      jobRole: details.jobRole,
      industry: details.industry,
      personaOther: details.personaOther,
    });

    // Atomic invite-stamp: only updates if still unused. Returning rowCount
    // lets us detect the lost race. Stamps whichever table the code came
    // from (admin allowlist vs per-user referral).
    if (invite) {
      const stamped =
        invite.kind === "admin"
          ? await db
              .update(inviteCodes)
              .set({ usedByUserId: userId, usedAt: sql`now()` })
              .where(
                and(
                  eq(inviteCodes.code, input.inviteCode),
                  isNull(inviteCodes.usedByUserId),
                ),
              )
              .returning({ code: inviteCodes.code })
          : await db
              .update(userInviteCodes)
              .set({ consumedByUserId: userId, consumedAt: sql`now()` })
              .where(
                and(
                  eq(userInviteCodes.code, input.inviteCode),
                  isNull(userInviteCodes.consumedByUserId),
                ),
              )
              .returning({ code: userInviteCodes.code });

      if (stamped.length === 0) {
        // Lost the race. Undo the user we just created so the invite stays
        // the only source of truth and the email is freed up.
        await db.delete(user).where(eq(user.id, userId));
        return { ok: false, error: "invite_invalid" };
      }
    }

    // Generate the new user's own 5 referral codes. Idempotent (PK conflict
    // on retry). Non-fatal — log and continue if something goes wrong.
    try {
      await ensureUserReferralCodes(userId, input.username);
    } catch (err) {
      console.error("[signup-real] referral code generation failed", err);
    }
  } catch (err) {
    // Drizzle/pg duplicate key (SQLSTATE 23505). We pre-checked but a
    // concurrent signup may have claimed the username between our SELECT
    // and UPDATE. Username is the only UNIQUE column updated here, so a
    // 23505 unambiguously means username collision.
    if (isUniqueViolation(err)) {
      await db.delete(user).where(eq(user.id, userId));
      return { ok: false, error: "username_taken" };
    }
    console.error("[signup-real] post-signup update failed", err);
    await db.delete(user).where(eq(user.id, userId));
    return { ok: false, error: "internal" };
  }

  return { ok: true, userId, headers };
}
