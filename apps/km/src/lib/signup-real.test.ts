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
  user as userTable,
} from "@episteme/db/schema";
import { signupRealUser } from "./signup-real";

const createdUserIds: string[] = [];
const createdInviteCodes: string[] = [];

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
});

describe("signupRealUser", () => {
  it("rejects when invite_code does not exist", async () => {
    const result = await signupRealUser({
      firstname: "Alice",
      email: `a_${uniq()}@test.local`,
      password: "test-password-1234",
      username: `alice_${uniq()}`.slice(0, 24),
      userType: "student",
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
      username: `bob_${uniq()}`.slice(0, 24),
      userType: "researcher",
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

  it("creates user, stamps invite, and persists extras on success", async () => {
    const code = await seedInvite();
    const username = `carol_${uniq()}`.slice(0, 24);
    const email = `c_${uniq()}@test.local`;

    const result = await signupRealUser({
      firstname: "Carol",
      email,
      password: "test-password-1234",
      username,
      userType: "industry",
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
});
