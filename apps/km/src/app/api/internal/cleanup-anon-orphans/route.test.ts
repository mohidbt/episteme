import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  papers,
  user as userTable,
} from "@episteme/db/schema";
import { storage, paperSourceKey } from "@/lib/storage";
import { ensureMinIOReady } from "@/app/api/_minio-setup";

// Stub @episteme/auth/internal: it pulls @episteme/auth/server → better-auth
// which is not resolvable under vitest's module loader in this app. The
// route's auth flow already accepts a Vercel-cron bearer BEFORE falling
// through to verifyInternalAuth, so for these tests the stub never runs.
vi.mock("@episteme/auth/internal", () => ({
  verifyInternalAuth: vi.fn(async () => ({ ok: false })),
  MissingInternalSecretError: class extends Error {},
}));

const { GET, POST } = await import("./route");

const createdUserIds: string[] = [];
const CRON_SECRET = "test-cron-secret-for-vitest";

function uid(): string {
  return `anon_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

async function insertOldAnon(ageDays: number): Promise<{ userId: string; paperId: string }> {
  const userId = uid();
  const createdAt = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
  await db.insert(userTable).values({
    id: userId,
    name: "Stale Anon",
    email: `${userId}@anon.local`,
    isAnonymous: true,
    createdAt,
    updatedAt: createdAt,
  });
  createdUserIds.push(userId);

  // Give them a paper + R2 object so we can verify cleanup.
  const { libraries } = await import("@episteme/db/schema");
  const [lib] = await db
    .insert(libraries)
    .values({ userId, name: "Example Library" })
    .returning();
  const [p] = await db
    .insert(papers)
    .values({
      userId,
      libraryId: lib.id,
      filename: "stale.pdf",
      title: "Stale anon paper",
    })
    .returning();
  await storage.uploadObject(
    paperSourceKey(p.id),
    Buffer.from("%PDF-1.4 fake"),
    "application/pdf",
  );
  return { userId, paperId: p.id };
}

beforeAll(async () => {
  await ensureMinIOReady();
  process.env.CRON_SECRET = CRON_SECRET;
});

afterAll(async () => {
  if (createdUserIds.length === 0) return;
  await db.delete(userTable).where(inArray(userTable.id, createdUserIds));
});

describe("POST/GET /api/internal/cleanup-anon-orphans", () => {
  it("401s without auth", async () => {
    const req = new Request("http://localhost/api/internal/cleanup-anon-orphans", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("401s with wrong bearer", async () => {
    const req = new Request("http://localhost/api/internal/cleanup-anon-orphans", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("Vercel-cron GET with bearer sweeps stale anons and deletes R2", { timeout: 60_000 }, async () => {
    const { userId, paperId } = await insertOldAnon(14);
    const r2Key = paperSourceKey(paperId);

    // RED: object exists before sweep.
    expect(
      (
        await fetch(await storage.getPresignedHead(r2Key, 30), { method: "HEAD" })
      ).status,
    ).toBe(200);

    // GET without x-vercel-cron header → 401 (defends against leaked secret).
    const reqNoCronHeader = new Request("http://localhost/api/internal/cleanup-anon-orphans", {
      method: "GET",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect((await GET(reqNoCronHeader)).status).toBe(401);

    const req = new Request("http://localhost/api/internal/cleanup-anon-orphans", {
      method: "GET",
      headers: {
        authorization: `Bearer ${CRON_SECRET}`,
        "x-vercel-cron": "1",
      },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      processed: number;
      candidates: string[];
    };
    expect(body.ok).toBe(true);
    expect(body.candidates).toContain(userId);

    // GREEN: user gone + R2 gone.
    expect(
      await db.select().from(userTable).where(eq(userTable.id, userId)),
    ).toHaveLength(0);
    expect(
      (
        await fetch(await storage.getPresignedHead(r2Key, 30), { method: "HEAD" })
      ).status,
    ).toBe(404);
  });

  it("dryRun does NOT delete anything", { timeout: 60_000 }, async () => {
    const { userId } = await insertOldAnon(14);
    const req = new Request("http://localhost/api/internal/cleanup-anon-orphans", {
      method: "POST",
      headers: {
        authorization: `Bearer ${CRON_SECRET}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ dryRun: true }),
    });
    const res = await POST(req);
    const body = (await res.json()) as {
      dryRun: boolean;
      processed: number;
      candidates: string[];
    };
    expect(body.dryRun).toBe(true);
    expect(body.processed).toBe(0);
    expect(body.candidates).toContain(userId);

    // User still exists.
    expect(
      await db.select().from(userTable).where(eq(userTable.id, userId)),
    ).toHaveLength(1);
  });

  it("maxAgeDays floor: cannot sweep newly-created anons even with 0", { timeout: 30_000 }, async () => {
    const userId = uid();
    await db.insert(userTable).values({
      id: userId,
      name: "Fresh Anon",
      email: `${userId}@anon.local`,
      isAnonymous: true,
    });
    createdUserIds.push(userId);

    const req = new Request("http://localhost/api/internal/cleanup-anon-orphans", {
      method: "POST",
      headers: {
        authorization: `Bearer ${CRON_SECRET}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ maxAgeDays: 0 }),
    });
    const res = await POST(req);
    const body = (await res.json()) as { candidates: string[] };
    expect(body.candidates).not.toContain(userId);
  });
});
