// Integration test: signupRealUser end-to-end against live Postgres.
//
// Covers the invite-gate policy + extras persistence. Library seeding side
// effects (onRealUserCreate) DO fire — we clean libraries/folders/notes for
// any user we create.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  folders,
  inviteCodes,
  libraries,
  notes,
  signupWaitlist,
  user as userTable,
  userInviteCodes,
  userSignupProfiles,
} from "@episteme/db/schema";
import {
  saveSignupWaitlistEntry,
  signupRealUser,
  validateInviteCode,
} from "./signup-real";

const createdUserIds: string[] = [];
const createdInviteCodes: string[] = [];
const waitlistEmails: string[] = [];

function uniq(): string {
  return `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

async function seedInvite(): Promise<string> {
  const code = `inv_${uniq()}`;
  await db.insert(inviteCodes).values({ code });
  createdInviteCodes.push(code);
  return code;
}

beforeAll(async () => {
  // tests assume the 0037 migration is applied locally; if firstname column
  // is missing, the schema-bound query will explode here.
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    // libraries/folders/notes FK back to user with cascade — single delete
    // wipes the seeded workspace cleanly.
    await db.delete(userTable).where(inArray(userTable.id, createdUserIds));
  }
  if (createdInviteCodes.length > 0) {
    await db
      .delete(inviteCodes)
      .where(inArray(inviteCodes.code, createdInviteCodes));
  }
  if (waitlistEmails.length > 0) {
    await db
      .delete(signupWaitlist)
      .where(inArray(signupWaitlist.email, waitlistEmails));
  }
});

describe("signupRealUser", () => {
  it("rejects when invite_code does not exist", async () => {
    const result = await signupRealUser({
      firstname: "Alice",
      email: `a_${uniq()}@test.local`,
      password: "test-password-1234",
      username: `alice-${uniq()}`.slice(0, 24),
      userType: "student",
      studentLevel: "Master",
      pokemon: "charmander",
      inviteCode: "does-not-exist-12345",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invite_invalid");
  });

  it("rejects when invite_code is already used", async () => {
    const code = await seedInvite();
    // Stamp it ourselves to simulate prior redemption.
    const [stub] = await db
      .insert(userTable)
      .values({
        id: `stub_${uniq()}`,
        name: "Stub",
        email: `stub_${uniq()}@test.local`,
      })
      .returning({ id: userTable.id });
    createdUserIds.push(stub.id);
    await db
      .update(inviteCodes)
      .set({ usedByUserId: stub.id, usedAt: new Date() })
      .where(eq(inviteCodes.code, code));

    const result = await signupRealUser({
      firstname: "Bob",
      email: `b_${uniq()}@test.local`,
      password: "test-password-1234",
      username: `bob-${uniq()}`.slice(0, 24),
      userType: "researcher",
      jobRole: "Principal investigator",
      pokemon: "squirtle",
      inviteCode: code,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invite_invalid");
  });

  it("rejects malformed payloads via zod", async () => {
    const result = await signupRealUser({
      firstname: "",
      email: "not-an-email",
      password: "short",
      username: "Bad Username",
      userType: "unknown",
      pokemon: "pikachu",
      inviteCode: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("validation");
  });

  it.each(["admin", "settings", "root", "support", "drive"])(
    "rejects reserved username %p with validation error",
    async (badName) => {
      const result = await signupRealUser({
        firstname: "Reserved",
        email: `r_${uniq()}@test.local`,
        password: "test-password-1234",
        username: badName,
        userType: "student",
        studentLevel: "Master",
        pokemon: "charmander",
        inviteCode: "not-needed-for-validation",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("validation");
    },
  );

  it("rejects underscores in username (unified regex)", async () => {
    const result = await signupRealUser({
      firstname: "Under",
      email: `u_${uniq()}@test.local`,
      password: "test-password-1234",
      username: "foo_bar",
      userType: "student",
      studentLevel: "Master",
      pokemon: "charmander",
      inviteCode: "not-needed-for-validation",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("validation");
  });

  it("rejects mismatched persona details server-side", async () => {
    const result = await signupRealUser({
      firstname: "Mismatch",
      email: `m_${uniq()}@test.local`,
      password: "test-password-1234",
      username: `mismatch-${uniq()}`.slice(0, 24),
      userType: "student",
      jobRole: "Analyst",
      pokemon: "charmander",
      inviteCode: "not-needed-for-validation",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("validation");
  });

  it("creates user, stamps invite, and persists extras plus persona profile on success", async () => {
    const code = await seedInvite();
    const username = `carol-${uniq()}`.slice(0, 24);
    const email = `c_${uniq()}@test.local`;

    const result = await signupRealUser({
      firstname: "Carol",
      email,
      password: "test-password-1234",
      username,
      userType: "industry",
      jobRole: "Product lead",
      industry: "Biotech",
      pokemon: "bulbasaur",
      inviteCode: code,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdUserIds.push(result.userId);

    const [row] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.id, result.userId))
      .limit(1);
    expect(row.email).toBe(email);
    expect(row.firstname).toBe("Carol");
    expect(row.username).toBe(username);
    expect(row.userType).toBe("industry");
    expect(row.pokemon).toBe("bulbasaur");
    expect(row.inviteCode).toBe(code);

    const [profile] = await db
      .select()
      .from(userSignupProfiles)
      .where(eq(userSignupProfiles.userId, result.userId))
      .limit(1);
    expect(profile.jobRole).toBe("Product lead");
    expect(profile.industry).toBe("Biotech");
    expect(profile.studentLevel).toBeNull();
    expect(profile.personaOther).toBeNull();

    const [invRow] = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.code, code))
      .limit(1);
    expect(invRow.usedByUserId).toBe(result.userId);
    expect(invRow.usedAt).not.toBeNull();

    // Library was seeded with firstname-derived label (via onRealUserCreate).
    const libs = await db
      .select({ name: libraries.name })
      .from(libraries)
      .where(eq(libraries.userId, result.userId));
    expect(libs[0]?.name).toBe("Carol's Library");

    // Belt-and-suspenders cleanup (afterAll cascade should handle it too):
    await db.delete(notes).where(eq(notes.userId, result.userId));
    await db.delete(folders).where(eq(folders.userId, result.userId));
    await db.delete(libraries).where(eq(libraries.userId, result.userId));
  });

  it("validates invite codes without creating users", async () => {
    const code = await seedInvite();

    await expect(validateInviteCode(code)).resolves.toEqual({ ok: true });

    const missing = await validateInviteCode("missing-code");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe("invite_invalid");
  });

  it("accepts a per-user referral code without FK violation (GSD-121)", async () => {
    // Seed an owner user + a user_invite_codes row.
    // Pre-fix: 0037 FK on user.invite_code rejects this with
    //   user_invite_code_fkey violation because referral codes live in
    //   user_invite_codes, not invite_codes.
    // Post-fix (0057): FK dropped → signup succeeds.
    const ownerUsername = `owner-${uniq()}`.slice(0, 24);
    const [owner] = await db
      .insert(userTable)
      .values({
        id: `owner_${uniq()}`,
        name: "Owner",
        email: `o_${uniq()}@test.local`,
        username: ownerUsername,
      })
      .returning({ id: userTable.id });
    createdUserIds.push(owner.id);

    const referralCode = `episteme-${ownerUsername}-1`;
    await db.insert(userInviteCodes).values({
      code: referralCode,
      ownerUserId: owner.id,
    });

    const result = await signupRealUser({
      firstname: "Referee",
      email: `r_${uniq()}@test.local`,
      password: "test-password-1234",
      username: `referee-${uniq()}`.slice(0, 24),
      userType: "researcher",
      jobRole: "Principal investigator",
      pokemon: "charmander",
      inviteCode: referralCode,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdUserIds.push(result.userId);

    const [row] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.id, result.userId))
      .limit(1);
    expect(row.inviteCode).toBe(referralCode);

    // Belt-and-suspenders cleanup.
    await db.delete(notes).where(eq(notes.userId, result.userId));
    await db.delete(folders).where(eq(folders.userId, result.userId));
    await db.delete(libraries).where(eq(libraries.userId, result.userId));
    await db
      .delete(userInviteCodes)
      .where(eq(userInviteCodes.code, referralCode));
  });

  it("upserts waitlist entries without requiring a password", async () => {
    const email = `wait_${uniq()}@test.local`;
    waitlistEmails.push(email);

    const first = await saveSignupWaitlistEntry({
      firstname: "Wendy",
      email,
      username: "wendy-one",
      userType: "student",
      studentLevel: "Bachelor",
      pokemon: "squirtle",
      attemptedInviteCode: "BAD-ONE",
    });
    expect(first.ok).toBe(true);

    const second = await saveSignupWaitlistEntry({
      firstname: "Wendy",
      email,
      username: "wendy-two",
      userType: "student",
      studentLevel: "PhD",
      pokemon: "bulbasaur",
      attemptedInviteCode: "BAD-TWO",
    });
    expect(second.ok).toBe(true);

    const [row] = await db
      .select()
      .from(signupWaitlist)
      .where(eq(signupWaitlist.email, email))
      .limit(1);
    expect(row.username).toBe("wendy-two");
    expect(row.studentLevel).toBe("PhD");
    expect(row.pokemon).toBe("bulbasaur");
    expect(row.attemptedInviteCode).toBe("BAD-TWO");
  });
});
