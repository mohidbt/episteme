import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  libraries,
  notes,
  papers,
  papersets,
  references_,
  user as userTable,
} from "@episteme/db/schema";
import { createAuth } from "@episteme/auth";
import { storage, paperSourceKey } from "@/lib/storage";
import { ensureMinIOReady } from "@/app/api/_minio-setup";
import { seedAnonymousUser } from "./seed-anonymous-user";
import { migrateAnonymousUser } from "./migrate-anonymous-user";

const createdUserIds: string[] = [];

const auth = createAuth({
  onAnonymousUserCreate: seedAnonymousUser,
  onAnonymousLink: migrateAnonymousUser,
});

beforeAll(async () => {
  await ensureMinIOReady();
});

afterAll(async () => {
  if (createdUserIds.length === 0) return;
  // Drop MinIO objects before users — once papers cascade-delete on user
  // delete, we lose the paperId needed to compute the storage key.
  for (const userId of createdUserIds) {
    const rows = await db
      .select({ id: papers.id })
      .from(papers)
      .where(eq(papers.userId, userId));
    await Promise.all(
      rows.map((r) =>
        storage.deleteObject(paperSourceKey(r.id)).catch(() => {}),
      ),
    );
  }
  await db.delete(userTable).where(inArray(userTable.id, createdUserIds));
});

describe("migrateAnonymousUser via onLinkAccount", () => {
  it("re-parents seeded library/note/paper/reference from anon → new user on sign-up", async () => {
    // 1. Anon sign-in → seed runs (library + note + paper + reference).
    const anon = await auth.api.signInAnonymous({ returnHeaders: true });
    const anonId = anon.response!.user.id;
    createdUserIds.push(anonId);

    const setCookie = anon.headers.get("set-cookie");
    if (!setCookie) throw new Error("signInAnonymous returned no set-cookie");
    const cookie = setCookie.split(";")[0];

    // Sanity-check the seed actually ran for the anon user.
    expect(
      await db.select().from(libraries).where(eq(libraries.userId, anonId)),
    ).toHaveLength(1);
    expect(
      await db.select().from(notes).where(eq(notes.userId, anonId)),
    ).toHaveLength(1);
    expect(
      await db.select().from(papers).where(eq(papers.userId, anonId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(references_)
        .where(eq(references_.userId, anonId)),
    ).toHaveLength(5);

    // Seed a paperset for the anon user — verifies migrate re-parents papersets too.
    const [libRow] = await db.select().from(libraries).where(eq(libraries.userId, anonId));
    const [anonPs] = await db.insert(papersets).values({
      libraryId: libRow.id, userId: anonId, folderId: null, filename: "anon.csv",
    }).returning({ id: papersets.id });

    // 2. Sign-up while holding the anon session cookie → onLinkAccount fires.
    const tag = `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    const headers = new Headers();
    headers.set("cookie", cookie);
    const signUp = await auth.api.signUpEmail({
      body: {
        email: `${tag}@test.local`,
        password: "test-password-1234",
        name: "Test User",
      },
      headers,
      returnHeaders: true,
    });
    const newId = (signUp.response as { user: { id: string } }).user.id;
    expect(newId).not.toBe(anonId);
    createdUserIds.push(newId);

    // 3. Anon user row should be deleted by the plugin (after migrate ran).
    const anonRow = await db
      .select()
      .from(userTable)
      .where(eq(userTable.id, anonId));
    expect(anonRow).toHaveLength(0);

    // 4. The new authed user row exists.
    const newRow = await db
      .select()
      .from(userTable)
      .where(eq(userTable.id, newId));
    expect(newRow).toHaveLength(1);
    expect(newRow[0].isAnonymous).toBe(false);

    // 5. All seeded rows now FK to newId, none orphaned to anonId.
    const libsForNew = await db
      .select()
      .from(libraries)
      .where(eq(libraries.userId, newId));
    expect(libsForNew).toHaveLength(1);
    expect(libsForNew[0].name).toBe("My Library");

    const notesForNew = await db
      .select()
      .from(notes)
      .where(eq(notes.userId, newId));
    expect(notesForNew).toHaveLength(1);
    expect(notesForNew[0].title).toBe("Welcome to Episteme");

    const papersForNew = await db
      .select()
      .from(papers)
      .where(eq(papers.userId, newId));
    expect(papersForNew).toHaveLength(1);
    expect(papersForNew[0].doi).toBe("10.48550/arXiv.2005.11401");

    const refsForNew = await db
      .select()
      .from(references_)
      .where(eq(references_.userId, newId));
    expect(refsForNew).toHaveLength(5);
    expect(
      refsForNew.some((r) => r.citationKey === "jumper2021highly"),
    ).toBe(true);

    const [psRow] = await db.select().from(papersets).where(eq(papersets.id, anonPs.id));
    expect(psRow.userId).toBe(newId);
  });
});
