import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets, libraries, notes, papers, user } from "@episteme/db/schema";
import {
  LIBRARY_BYTES_LIMIT,
  getLibraryUsageBytes,
} from "@/lib/library-usage";

// Pure-DB test: insert directly into `user` to dodge better-auth so this
// suite still runs when the broader auth-dependent infra is red on main.
async function makeUser(): Promise<string> {
  const id = `lu_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  await db.insert(user).values({
    id,
    name: "lu",
    email: `${id}@t.local`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

const userIds: string[] = [];
let libA: number;
let libB: number;

beforeAll(async () => {
  const uA = await makeUser();
  const uB = await makeUser();
  userIds.push(uA, uB);
  const [a] = await db
    .insert(libraries)
    .values({ userId: uA, name: "A" })
    .returning({ id: libraries.id });
  libA = a.id;
  const [b] = await db
    .insert(libraries)
    .values({ userId: uB, name: "B" })
    .returning({ id: libraries.id });
  libB = b.id;

  for (const size of [10, 20, 30]) {
    await db
      .insert(papers)
      .values({ libraryId: libA, userId: uA, filename: `p${size}.pdf`, title: "p", sizeBytes: size });
  }
  for (const size of [100, 200, 300]) {
    await db
      .insert(notes)
      .values({
        libraryId: libA,
        userId: uA,
        title: `n${size}`,
        slug: `n-${size}-${Math.random().toString(36).slice(2, 8)}`,
        contentMd: "",
        sizeBytes: size,
      });
  }
  for (const size of [1000, 2000, 3000]) {
    await db
      .insert(assets)
      .values({
        libraryId: libA,
        userId: uA,
        filename: `a${size}`,
        mimeType: "image/png",
        sizeBytes: size,
      });
  }
  await db
    .insert(papers)
    .values({ libraryId: libB, userId: uB, filename: "x.pdf", title: "x", sizeBytes: 5000 });
  await db
    .insert(notes)
    .values({
      libraryId: libB,
      userId: uB,
      title: "x",
      slug: `x-${Math.random().toString(36).slice(2, 8)}`,
      contentMd: "",
      sizeBytes: 5000,
    });
  await db
    .insert(assets)
    .values({ libraryId: libB, userId: uB, filename: "x", mimeType: "image/png", sizeBytes: 5000 });
});

afterAll(async () => {
  if (userIds.length) await db.delete(user).where(inArray(user.id, userIds));
});

describe("getLibraryUsageBytes", () => {
  it("sums papers, notes, assets per library", async () => {
    const usage = await getLibraryUsageBytes(libA);
    expect(usage.papers).toBe(60);
    expect(usage.notes).toBe(600);
    expect(usage.assets).toBe(6000);
    expect(usage.total).toBe(6660);
  });

  it("scopes by libraryId — does not include other libraries", async () => {
    const usage = await getLibraryUsageBytes(libB);
    expect(usage.papers).toBe(5000);
    expect(usage.notes).toBe(5000);
    expect(usage.assets).toBe(5000);
    expect(usage.total).toBe(15000);
  });

  it("returns zeros for a library with no rows", async () => {
    const usage = await getLibraryUsageBytes(-1);
    expect(usage).toEqual({ papers: 0, notes: 0, assets: 0, total: 0 });
  });

  it("exposes a 100 MB constant", () => {
    expect(LIBRARY_BYTES_LIMIT).toBe(100 * 1024 * 1024);
  });

  // unused import guard
  void eq;
});
