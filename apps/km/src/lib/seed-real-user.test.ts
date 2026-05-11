import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  folders,
  libraries,
  notes,
  user as userTable,
} from "@episteme/db/schema";
import { seedRealUser } from "./seed-real-user";

const createdUserIds: string[] = [];

function makeRealId(): string {
  return `real_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

async function insertRealUser(): Promise<string> {
  const id = makeRealId();
  await db.insert(userTable).values({
    id,
    name: "Real Test User",
    email: `${id}@test.local`,
    isAnonymous: false,
  });
  createdUserIds.push(id);
  return id;
}

afterAll(async () => {
  if (createdUserIds.length === 0) return;
  await db.delete(userTable).where(inArray(userTable.id, createdUserIds));
});

describe("seedRealUser", () => {
  it("creates 'My Library' + Trash folder + welcome note ONLY (no demo papers/refs/papersets)", { timeout: 30_000 }, async () => {
    const userId = await insertRealUser();
    await seedRealUser(userId);

    const libs = await db
      .select()
      .from(libraries)
      .where(eq(libraries.userId, userId));
    expect(libs).toHaveLength(1);
    expect(libs[0].name).toBe("My Library");

    const allFolders = await db
      .select()
      .from(folders)
      .where(eq(folders.libraryId, libs[0].id));
    expect(allFolders).toHaveLength(1);
    expect(allFolders[0].isTrash).toBe(true);

    const noteRows = await db
      .select()
      .from(notes)
      .where(eq(notes.userId, userId));
    expect(noteRows).toHaveLength(1);
    expect(noteRows[0].title).toBe("Welcome to Episteme");
    expect(noteRows[0].contentMd).toContain("# Welcome to Episteme");
  });

  it("is idempotent on a second call", { timeout: 30_000 }, async () => {
    const userId = await insertRealUser();
    await seedRealUser(userId);
    await seedRealUser(userId);

    const libs = await db
      .select()
      .from(libraries)
      .where(eq(libraries.userId, userId));
    expect(libs).toHaveLength(1);

    const noteRows = await db
      .select()
      .from(notes)
      .where(eq(notes.userId, userId));
    expect(noteRows).toHaveLength(1);
  });

  it("survives concurrent seed (libraries_user_id_unique race)", { timeout: 30_000 }, async () => {
    const userId = await insertRealUser();
    // Two concurrent invocations — both pass the early-return precheck
    // because neither has committed yet. Exactly one wins the unique
    // constraint; the other must swallow the violation, NOT throw.
    const results = await Promise.allSettled([
      seedRealUser(userId),
      seedRealUser(userId),
    ]);
    for (const r of results) {
      expect(r.status).toBe("fulfilled");
    }

    const libs = await db
      .select()
      .from(libraries)
      .where(eq(libraries.userId, userId));
    expect(libs).toHaveLength(1);
  });
});
