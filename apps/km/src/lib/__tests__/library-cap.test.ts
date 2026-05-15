import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets, libraries, user } from "@episteme/db/schema";
import {
  LIBRARY_BYTES_LIMIT,
  assertWithinLibraryLimit,
} from "@/lib/library-usage";

async function makeUser(): Promise<string> {
  const id = `lc_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  await db.insert(user).values({
    id,
    name: "lc",
    email: `${id}@t.local`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

const userIds: string[] = [];
let libId: number;

beforeAll(async () => {
  const u = await makeUser();
  userIds.push(u);
  const [lib] = await db
    .insert(libraries)
    .values({ userId: u, name: "C" })
    .returning({ id: libraries.id });
  libId = lib.id;
  // Pre-fill library to exactly `LIBRARY_BYTES_LIMIT - 1` via assets
  // (single row; assets supports arbitrary sizeBytes).
  await db.insert(assets).values({
    libraryId: libId,
    userId: u,
    filename: "big",
    mimeType: "image/png",
    sizeBytes: LIBRARY_BYTES_LIMIT - 1,
  });
});

afterAll(async () => {
  if (userIds.length) await db.delete(user).where(inArray(user.id, userIds));
});

describe("assertWithinLibraryLimit", () => {
  it("returns ok=true at exactly the limit (used+incoming == limit)", async () => {
    const result = await assertWithinLibraryLimit(libId, 1);
    expect(result.ok).toBe(true);
  });

  it("returns ok=false when used+incoming exceeds the limit by 1 byte", async () => {
    const result = await assertWithinLibraryLimit(libId, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.usedBytes).toBe(LIBRARY_BYTES_LIMIT - 1);
      expect(result.limitBytes).toBe(LIBRARY_BYTES_LIMIT);
    }
  });

  it("zero-byte incoming with full library is still ok (idempotent reads)", async () => {
    const result = await assertWithinLibraryLimit(libId, 0);
    expect(result.ok).toBe(true);
  });
});
