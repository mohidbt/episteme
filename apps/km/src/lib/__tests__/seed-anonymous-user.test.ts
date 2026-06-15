import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { libraries, notes, papers, user } from "@episteme/db/schema";
import { seedAnonymousUser } from "@/lib/seed-anonymous-user";

// N9: guest /settings/data showed 0.0 MB for PDFs and notes because the seed
// inserted papers + notes rows without `sizeBytes`. Verify every seeded row
// gets a non-null, non-zero sizeBytes.

const userId = `seedn9_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

beforeAll(async () => {
  await db.insert(user).values({
    id: userId,
    name: "seedn9",
    email: `${userId}@t.local`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await seedAnonymousUser(userId);
}, 120_000);

afterAll(async () => {
  await db.delete(user).where(eq(user.id, userId));
});

describe("seedAnonymousUser sizeBytes", () => {
  it("writes sizeBytes > 0 for every seeded paper", async () => {
    const rows = await db
      .select({ id: papers.id, filename: papers.filename, sizeBytes: papers.sizeBytes })
      .from(papers)
      .where(eq(papers.userId, userId));
    expect(rows.length).toBeGreaterThanOrEqual(4); // RAG + 3 PSM (GSD-91: bio removed)
    for (const r of rows) {
      expect(r.sizeBytes, `paper ${r.filename}`).not.toBeNull();
      expect(Number(r.sizeBytes), `paper ${r.filename}`).toBeGreaterThan(0);
    }
  });

  it("writes sizeBytes > 0 for every seeded note", async () => {
    const rows = await db
      .select({ id: notes.id, title: notes.title, sizeBytes: notes.sizeBytes })
      .from(notes)
      .where(eq(notes.userId, userId));
    expect(rows.length).toBeGreaterThanOrEqual(3); // Welcome + Underserved Pathway + GAN Controls (GSD-91)
    for (const r of rows) {
      expect(r.sizeBytes, `note ${r.title}`).not.toBeNull();
      expect(Number(r.sizeBytes), `note ${r.title}`).toBeGreaterThan(0);
    }
  });

  // Sanity: library exists (seed didn't fail silently before our assertions)
  it("creates exactly one library for the guest user", async () => {
    const libs = await db
      .select()
      .from(libraries)
      .where(eq(libraries.userId, userId));
    expect(libs.length).toBe(1);
  });
});
