// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { libraries, notes, user } from "@episteme/db/schema";
import { createTestUser, deleteTestUser, type TestUser } from "../../../api/_test-utils";
import { getPublicNote } from "./_loader";

const rand = () => Math.random().toString(36).slice(2, 8);

let u: TestUser;
let libraryId: number;

async function setUsername(userId: string, username: string) {
  await db.update(user).set({ username }).where(eq(user.id, userId));
}

async function clearUsername(userId: string) {
  await db.update(user).set({ username: null }).where(eq(user.id, userId));
}

async function mkNote(opts: {
  title: string;
  contentMd?: string;
  isPublic: boolean;
  publicSlug: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(notes)
    .values({
      libraryId,
      userId: u.id,
      title: opts.title,
      slug: `${rand()}-${rand()}`,
      contentMd: opts.contentMd ?? "",
      isPublic: opts.isPublic,
      publicSlug: opts.publicSlug,
    })
    .returning({ id: notes.id });
  return row.id;
}

beforeAll(async () => {
  u = await createTestUser();
  const [lib] = await db
    .insert(libraries)
    .values({ userId: u.id, name: "Pub Loader Lib" })
    .returning({ id: libraries.id });
  libraryId = lib.id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
});

describe("getPublicNote", () => {
  it("returns row when note is public and user + slug match", async () => {
    const username = `alice${rand()}`;
    await setUsername(u.id, username);
    const slug = `hello-${rand()}`;
    await mkNote({
      title: "Hello World",
      contentMd: "# Hi\n\nbody",
      isPublic: true,
      publicSlug: slug,
    });

    const row = await getPublicNote(username, slug);
    expect(row).not.toBeNull();
    expect(row?.title).toBe("Hello World");
    expect(row?.contentMd).toBe("# Hi\n\nbody");
    expect(row?.username).toBe(username);
    expect(row?.authorName).toBe("Test User");
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it("returns null when note is private", async () => {
    const username = `bob${rand()}`;
    await setUsername(u.id, username);
    const slug = `priv-${rand()}`;
    await mkNote({
      title: "Private",
      isPublic: false,
      publicSlug: slug,
    });

    const row = await getPublicNote(username, slug);
    expect(row).toBeNull();
  });

  it("returns null when username does not match", async () => {
    const username = `carol${rand()}`;
    await setUsername(u.id, username);
    const slug = `pub-${rand()}`;
    await mkNote({
      title: "Pub",
      isPublic: true,
      publicSlug: slug,
    });

    const row = await getPublicNote(`ghost${rand()}`, slug);
    expect(row).toBeNull();
  });

  it("returns null when slug does not match", async () => {
    const username = `dave${rand()}`;
    await setUsername(u.id, username);
    await mkNote({
      title: "Pub",
      isPublic: true,
      publicSlug: `real-${rand()}`,
    });

    const row = await getPublicNote(username, `missing-${rand()}`);
    expect(row).toBeNull();
  });

  it("returns null when user has no username", async () => {
    await clearUsername(u.id);
    const slug = `orphan-${rand()}`;
    await mkNote({
      title: "Orphan",
      isPublic: true,
      publicSlug: slug,
    });

    // Would-be lookup with empty/null username must not hit this row.
    const row = await getPublicNote("", slug);
    expect(row).toBeNull();
  });
});
