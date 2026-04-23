import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { folders, libraries, notes } from "@episteme/db/schema";
import { eq } from "drizzle-orm";
import { resolveDrivePath } from "./resolve";
import {
  createTestUser,
  deleteTestUser,
  type TestUser,
} from "@/app/api/_test-utils";

let u: TestUser;
let libraryId: number;
let folderAId: string;

beforeAll(async () => {
  u = await createTestUser();
  const [lib] = await db
    .insert(libraries)
    .values({ userId: u.id, name: "Default" })
    .returning({ id: libraries.id });
  libraryId = lib.id;
  const [a] = await db
    .insert(folders)
    .values({ libraryId, userId: u.id, parentId: null, name: "A" })
    .returning({ id: folders.id });
  folderAId = a.id;
  await db.insert(notes).values({
    libraryId,
    userId: u.id,
    folderId: folderAId,
    title: "Inside A",
    slug: `drive-test-${Date.now()}`,
    contentMd: "",
  });
});

afterAll(async () => {
  await deleteTestUser(u.id);
});

describe("resolveDrivePath", () => {
  it("resolves a single segment to the matching folder chain", async () => {
    const chain = await resolveDrivePath(libraryId, u.id, ["A"]);
    expect(chain).not.toBeNull();
    expect(chain?.length).toBe(1);
    expect(chain?.[0]?.name).toBe("A");
    expect(chain?.[0]?.id).toBe(folderAId);
  });

  it("returns null when a path segment does not match any folder", async () => {
    const chain = await resolveDrivePath(libraryId, u.id, ["nonexistent"]);
    expect(chain).toBeNull();
  });

  it("decodes percent-encoded segments before matching", async () => {
    const [withSpace] = await db
      .insert(folders)
      .values({ libraryId, userId: u.id, parentId: null, name: "Hello World" })
      .returning({ id: folders.id });
    try {
      const chain = await resolveDrivePath(libraryId, u.id, ["Hello%20World"]);
      expect(chain?.[0]?.name).toBe("Hello World");
    } finally {
      await db.delete(folders).where(eq(folders.id, withSpace.id));
    }
  });
});
