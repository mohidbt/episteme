// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { libraries, notes, user } from "@episteme/db/schema";
import {
  createTestUser,
  deleteTestUser,
  params,
  req,
  type TestUser,
} from "../../../../api/_test-utils";
import { GET } from "./route";

const rand = () => Math.random().toString(36).slice(2, 8);

let u: TestUser;
let libraryId: number;
let username: string;

async function mkNote(opts: {
  title: string;
  contentMd: string;
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
      contentMd: opts.contentMd,
      isPublic: opts.isPublic,
      publicSlug: opts.publicSlug,
    })
    .returning({ id: notes.id });
  return row.id;
}

beforeAll(async () => {
  u = await createTestUser();
  username = `src${rand()}`;
  await db.update(user).set({ username }).where(eq(user.id, u.id));
  const [lib] = await db
    .insert(libraries)
    .values({ userId: u.id, name: "Pub Src Lib" })
    .returning({ id: libraries.id });
  libraryId = lib.id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
});

describe("GET /pub/:user/:slug/source", () => {
  it("404 when note does not exist", async () => {
    const res = await GET(
      req(`/pub/nobody${rand()}/missing`),
      params({ user: `nobody${rand()}`, slug: "missing" }),
    );
    expect(res.status).toBe(404);
  });

  it("404 when note is private", async () => {
    const slug = `priv-${rand()}`;
    await mkNote({
      title: "Private",
      contentMd: "secret",
      isPublic: false,
      publicSlug: slug,
    });

    const res = await GET(
      req(`/pub/${username}/${slug}/source`),
      params({ user: username, slug }),
    );
    expect(res.status).toBe(404);
  });

  it("200 + text/markdown when public", async () => {
    const slug = `pub-${rand()}`;
    const md = "# Heading\n\nbody paragraph.";
    await mkNote({
      title: "Public Note",
      contentMd: md,
      isPublic: true,
      publicSlug: slug,
    });

    const res = await GET(
      req(`/pub/${username}/${slug}/source`),
      params({ user: username, slug }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const body = await res.text();
    expect(body).toBe(md);
  });
});
