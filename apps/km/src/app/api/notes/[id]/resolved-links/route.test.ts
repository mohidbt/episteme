import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { noteLinks } from "@episteme/db/schema";
import { GET } from "./route";
import { POST as POST_NOTE } from "../../route";
import { POST as POST_LIB } from "../../../libraries/route";
import { createTestUser, deleteTestUser, params, req, type TestUser } from "../../../_test-utils";
import { getResolvedLinks } from "@/lib/notes/resolved-links";

let u: TestUser;
let other: TestUser;
let sourceId: string;
let target: { id: string; slug: string };

async function createNote(libraryId: number, title: string) {
  const r = await POST_NOTE(
    req("/api/notes", { method: "POST", cookie: u.cookie, body: JSON.stringify({ libraryId, title }) }),
  );
  return (await r.json()) as { id: string; slug: string };
}

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name: "Resolved Links Lib" }) }),
  );
  const libraryId = (await r.json()).id;
  sourceId = (await createNote(libraryId, "Links Source")).id;
  target = await createNote(libraryId, "Links Target");
  await db.insert(noteLinks).values({
    sourceNoteId: sourceId,
    targetKind: "note",
    targetId: target.id,
    targetTitleRaw: "Links Target",
  });
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("GET /api/notes/:id/resolved-links", () => {
  it("401 when no user", async () => {
    const r = await GET(req(`/api/notes/${sourceId}/resolved-links`), params({ id: sourceId }));
    expect(r.status).toBe(401);
  });

  it("403 for a note owned by someone else", async () => {
    const r = await GET(
      req(`/api/notes/${sourceId}/resolved-links`, { cookie: other.cookie }),
      params({ id: sourceId }),
    );
    expect(r.status).toBe(403);
  });

  it("returns the same map the note page builds", async () => {
    const r = await GET(
      req(`/api/notes/${sourceId}/resolved-links`, { cookie: u.cookie }),
      params({ id: sourceId }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual(await getResolvedLinks(sourceId));
    expect(body["note::links target"]).toEqual({
      targetKind: "note",
      targetId: target.id,
      targetSlug: target.slug,
      displayTitle: "Links Target",
    });
  });
});
