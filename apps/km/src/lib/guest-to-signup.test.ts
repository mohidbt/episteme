import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  assets,
  folders,
  libraries,
  notes,
  papers,
  papersets,
  references_,
  user as userTable,
} from "@episteme/db/schema";
import { storage, paperSourceKey, paperCoverKey } from "@/lib/storage";
import { ensureMinIOReady } from "@/app/api/_minio-setup";
import { seedAnonymousUser } from "./seed-anonymous-user";
import { seedRealUser } from "./seed-real-user";
import { cleanupAnonymousR2, cleanupUserR2 } from "./cleanup-anonymous-r2";

const createdUserIds: string[] = [];

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

async function insertUser(prefix: string, isAnonymous: boolean): Promise<string> {
  const userId = id(prefix);
  await db.insert(userTable).values({
    id: userId,
    name: isAnonymous ? "Anonymous" : "Real User",
    email: `${userId}@${isAnonymous ? "anon" : "test"}.local`,
    isAnonymous,
  });
  createdUserIds.push(userId);
  return userId;
}

async function r2Exists(key: string): Promise<boolean> {
  const url = await storage.getPresignedHead(key, 30);
  const r = await fetch(url, { method: "HEAD" });
  return r.status === 200;
}

beforeAll(async () => {
  await ensureMinIOReady();
});

afterAll(async () => {
  if (createdUserIds.length === 0) return;
  for (const userId of createdUserIds) {
    // Best-effort R2 cleanup before user delete (papers cascade).
    try {
      await cleanupUserR2(userId);
    } catch {
      // ignore
    }
  }
  await db.delete(userTable).where(inArray(userTable.id, createdUserIds));
});

describe("guest → real signup discard flow (integration)", () => {
  it("signup-from-anon: anon data wiped, real user has only My Library", { timeout: 120_000 }, async () => {
    // === ARRANGE: simulate guest session post-seed ===
    const anonId = await insertUser("anon", true);
    await seedAnonymousUser(anonId);

    const anonPapersBefore = await db
      .select({ id: papers.id })
      .from(papers)
      .where(eq(papers.userId, anonId));
    expect(anonPapersBefore.length).toBeGreaterThan(0);

    // Capture R2 keys we expect to be deleted.
    const r2KeysAnon = anonPapersBefore.flatMap((p) => [
      paperSourceKey(p.id),
      paperCoverKey(p.id),
    ]);

    // Sanity: at least the RAG seed PDF should exist in R2 right now (RED).
    const ragKey = paperSourceKey(anonPapersBefore[0].id);
    expect(await r2Exists(ragKey)).toBe(true);

    // === ACT: simulate better-auth signup-from-anon flow ===
    // 1) user.create.after(B, isAnon=false) → seedRealUser
    const realId = await insertUser("real", false);
    await seedRealUser(realId);

    // 2) anon plugin onLinkAccount → cleanupAnonymousR2
    await cleanupAnonymousR2(anonId, realId);

    // 3) better-auth deletes anon user → cascade
    await db.delete(userTable).where(eq(userTable.id, anonId));

    // === ASSERT: R2 cleaned ===
    for (const key of r2KeysAnon) {
      expect(await r2Exists(key)).toBe(false);
    }

    // === ASSERT: DB cascade wiped every anon-owned row ===
    expect(
      await db.select().from(libraries).where(eq(libraries.userId, anonId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(folders).where(eq(folders.userId, anonId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(notes).where(eq(notes.userId, anonId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(papers).where(eq(papers.userId, anonId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(references_).where(eq(references_.userId, anonId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(papersets).where(eq(papersets.userId, anonId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(assets).where(eq(assets.userId, anonId)),
    ).toHaveLength(0);

    // === ASSERT: real user has minimal welcome workspace ===
    const realLibs = await db
      .select()
      .from(libraries)
      .where(eq(libraries.userId, realId));
    expect(realLibs).toHaveLength(1);
    expect(realLibs[0].name).toBe("My Library");

    const realFolders = await db
      .select()
      .from(folders)
      .where(eq(folders.userId, realId));
    expect(realFolders).toHaveLength(1);
    expect(realFolders[0].isTrash).toBe(true);

    const realNotes = await db
      .select()
      .from(notes)
      .where(eq(notes.userId, realId));
    expect(realNotes).toHaveLength(1);
    expect(realNotes[0].title).toBe("Welcome to Episteme");

    // No demo content leaked to real user.
    expect(
      await db.select().from(papers).where(eq(papers.userId, realId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(references_).where(eq(references_.userId, realId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(papersets).where(eq(papersets.userId, realId)),
    ).toHaveLength(0);
  });

  it("re-link to existing account: survivor untouched, anon dies", { timeout: 120_000 }, async () => {
    // === ARRANGE ===
    // Existing real user with their own seeded workspace.
    const survivorId = await insertUser("survivor", false);
    await seedRealUser(survivorId);
    const survivorLibBefore = (
      await db.select().from(libraries).where(eq(libraries.userId, survivorId))
    )[0];

    // Anon session about to sign IN to the survivor's account.
    const anonId = await insertUser("anon", true);
    await seedAnonymousUser(anonId);
    const anonPaperIds = (
      await db
        .select({ id: papers.id })
        .from(papers)
        .where(eq(papers.userId, anonId))
    ).map((p) => p.id);

    // === ACT: simulate signin-from-anon (NO new user is created — no
    // user.create.after fires; only onLinkAccount + anon deletion) ===
    await cleanupAnonymousR2(anonId, survivorId);
    await db.delete(userTable).where(eq(userTable.id, anonId));

    // === ASSERT: survivor untouched ===
    const survivorLibAfter = (
      await db.select().from(libraries).where(eq(libraries.userId, survivorId))
    )[0];
    expect(survivorLibAfter.id).toBe(survivorLibBefore.id);
    expect(survivorLibAfter.name).toBe("My Library");

    // === ASSERT: anon gone ===
    expect(
      await db.select().from(papers).where(eq(papers.userId, anonId)),
    ).toHaveLength(0);
    for (const pid of anonPaperIds) {
      expect(await r2Exists(paperSourceKey(pid))).toBe(false);
    }
  });

  it("cleanupUserR2 covers BOTH seed and agent-fetched papers (uniform enumeration)", { timeout: 60_000 }, async () => {
    // Simulate agent-fetched paper: a real-shaped paper row + R2 object that
    // didn't come from seedAnonymousUser. cleanupUserR2 should remove it.
    const anonId = await insertUser("anon", true);

    // Need a library for the FK.
    const [lib] = await db
      .insert(libraries)
      .values({ userId: anonId, name: "Example Library" })
      .returning();

    const [agentPaper] = await db
      .insert(papers)
      .values({
        userId: anonId,
        libraryId: lib.id,
        filename: "agent-fetched.pdf",
        title: "Agent fetched paper",
      })
      .returning();

    await storage.uploadObject(
      paperSourceKey(agentPaper.id),
      Buffer.from("%PDF-1.4 fake"),
      "application/pdf",
    );
    expect(await r2Exists(paperSourceKey(agentPaper.id))).toBe(true);

    await cleanupUserR2(anonId);
    expect(await r2Exists(paperSourceKey(agentPaper.id))).toBe(false);
  });
});
