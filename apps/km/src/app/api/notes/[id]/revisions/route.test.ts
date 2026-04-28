// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GET, POST } from "./route";
import { POST as POST_LIB } from "../../../libraries/route";
import { POST as POST_NOTE } from "../../route";
import { db } from "@/lib/db";
import { notes, noteRevisions } from "@episteme/db/schema";
import {
  createTestUser,
  deleteTestUser,
  params,
  req,
  type TestUser,
} from "../../../_test-utils";

let u: TestUser;
let other: TestUser;
let libraryId: number;

async function mkNote(cookie: string, title: string, contentMd?: string) {
  const n = await POST_NOTE(
    req("/api/notes", {
      method: "POST",
      cookie,
      body: JSON.stringify({ libraryId, title }),
    }),
  );
  const row = await n.json();
  if (contentMd !== undefined) {
    await db.update(notes).set({ contentMd }).where(eq(notes.id, row.id));
  }
  return row.id as string;
}

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "Revs Lib" }),
    }),
  );
  libraryId = (await r.json()).id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("GET /api/notes/:id/revisions", () => {
  it("401 when unauthenticated", async () => {
    const noteId = await mkNote(u.cookie, "Rev GET no auth");
    const r = await GET(
      req(`/api/notes/${noteId}/revisions`, { method: "GET" }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(401);
  });

  it("404 when note owned by another user", async () => {
    const noteId = await mkNote(u.cookie, "Rev GET other user");
    const r = await GET(
      req(`/api/notes/${noteId}/revisions`, {
        method: "GET",
        cookie: other.cookie,
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(404);
  });

  it("200 with empty array when note has no revisions", async () => {
    // insert note directly to avoid the seeded manual revision from POST_NOTE
    const [seed] = await db
      .insert(notes)
      .values({
        userId: u.id,
        libraryId,
        title: "Rev GET empty",
        slug: `rev-get-empty-${Date.now()}`,
      })
      .returning();
    const r = await GET(
      req(`/api/notes/${seed.id}/revisions`, {
        method: "GET",
        cookie: u.cookie,
      }),
      params({ id: seed.id }),
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([]);
  });

  it("returns rows ordered by createdAt DESC, id DESC", async () => {
    const [seed] = await db
      .insert(notes)
      .values({
        userId: u.id,
        libraryId,
        title: "Rev GET order",
        slug: `rev-get-order-${Date.now()}`,
      })
      .returning();
    const t0 = new Date("2024-01-01T00:00:00Z");
    const t1 = new Date("2024-01-02T00:00:00Z");
    const t2 = new Date("2024-01-03T00:00:00Z");
    await db.insert(noteRevisions).values([
      { noteId: seed.id, authorId: u.id, contentMd: "a", reason: "manual", createdAt: t0 },
      { noteId: seed.id, authorId: u.id, contentMd: "b", reason: "manual", createdAt: t1 },
      { noteId: seed.id, authorId: u.id, contentMd: "c", reason: "manual", createdAt: t2 },
    ]);
    const r = await GET(
      req(`/api/notes/${seed.id}/revisions`, {
        method: "GET",
        cookie: u.cookie,
      }),
      params({ id: seed.id }),
    );
    expect(r.status).toBe(200);
    const rows = (await r.json()) as Array<{
      id: string;
      createdAt: string;
      reason: string;
      charCount: number;
    }>;
    expect(rows).toHaveLength(3);
    // newest first
    expect(new Date(rows[0].createdAt).toISOString()).toBe(t2.toISOString());
    expect(new Date(rows[1].createdAt).toISOString()).toBe(t1.toISOString());
    expect(new Date(rows[2].createdAt).toISOString()).toBe(t0.toISOString());
  });

  it("charCount matches contentMd.length", async () => {
    const [seed] = await db
      .insert(notes)
      .values({
        userId: u.id,
        libraryId,
        title: "Rev GET charcount",
        slug: `rev-get-charcount-${Date.now()}`,
      })
      .returning();
    await db.insert(noteRevisions).values([
      { noteId: seed.id, authorId: u.id, contentMd: "abc", reason: "manual" },
      { noteId: seed.id, authorId: u.id, contentMd: "hello world!!", reason: "manual" },
    ]);
    const r = await GET(
      req(`/api/notes/${seed.id}/revisions`, {
        method: "GET",
        cookie: u.cookie,
      }),
      params({ id: seed.id }),
    );
    const rows = (await r.json()) as Array<{ charCount: number }>;
    const counts = rows.map((x) => x.charCount).sort((a, b) => a - b);
    expect(counts).toEqual([3, 13]);
  });

  it("does NOT include contentMd in the list", async () => {
    const [seed] = await db
      .insert(notes)
      .values({
        userId: u.id,
        libraryId,
        title: "Rev GET no body",
        slug: `rev-get-nobody-${Date.now()}`,
      })
      .returning();
    await db.insert(noteRevisions).values([
      { noteId: seed.id, authorId: u.id, contentMd: "should not leak", reason: "manual" },
    ]);
    const r = await GET(
      req(`/api/notes/${seed.id}/revisions`, {
        method: "GET",
        cookie: u.cookie,
      }),
      params({ id: seed.id }),
    );
    const rows = (await r.json()) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("contentMd");
    expect(Object.keys(rows[0]).sort()).toEqual(
      ["agentSkill", "authorKind", "charCount", "createdAt", "id", "reason"].sort(),
    );
  });

  it("returns authorKind and agentSkill columns (defaults + agent rows)", async () => {
    const [seed] = await db
      .insert(notes)
      .values({
        userId: u.id,
        libraryId,
        title: "Rev GET agent cols",
        slug: `rev-get-agent-${Date.now()}`,
      })
      .returning();
    await db.insert(noteRevisions).values([
      { noteId: seed.id, authorId: u.id, contentMd: "u", reason: "manual" },
      {
        noteId: seed.id,
        authorId: u.id,
        contentMd: "a",
        reason: "agent-write",
        authorKind: "agent",
        agentSkill: "lit-triage",
      },
    ]);
    const r = await GET(
      req(`/api/notes/${seed.id}/revisions`, {
        method: "GET",
        cookie: u.cookie,
      }),
      params({ id: seed.id }),
    );
    expect(r.status).toBe(200);
    const rows = (await r.json()) as Array<{
      authorKind: string;
      agentSkill: string | null;
      reason: string;
    }>;
    expect(rows).toHaveLength(2);
    const agentRow = rows.find((x) => x.authorKind === "agent");
    const userRow = rows.find((x) => x.authorKind === "user");
    expect(agentRow).toBeTruthy();
    expect(agentRow!.agentSkill).toBe("lit-triage");
    expect(agentRow!.reason).toBe("agent-write");
    expect(userRow).toBeTruthy();
    expect(userRow!.agentSkill).toBeNull();
  });
});

describe("POST /api/notes/:id/revisions", () => {
  it("201 with empty body creates a manual revision from current contentMd", async () => {
    const noteId = await mkNote(u.cookie, "Rev POST empty body", "current body");
    const r = await POST(
      req(`/api/notes/${noteId}/revisions`, {
        method: "POST",
        cookie: u.cookie,
        body: "",
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(201);
    const body = (await r.json()) as { id: string; reason: string; createdAt: string };
    expect(body.reason).toBe("manual");
    const [inserted] = await db
      .select()
      .from(noteRevisions)
      .where(eq(noteRevisions.id, body.id));
    expect(inserted.contentMd).toBe("current body");
    expect(inserted.reason).toBe("manual");
    expect(inserted.noteId).toBe(noteId);
  });

  it("201 with body { reason: 'pre-ai-edit' } creates a pre-ai-edit revision", async () => {
    const noteId = await mkNote(u.cookie, "Rev POST preai", "pre ai body");
    const r = await POST(
      req(`/api/notes/${noteId}/revisions`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ reason: "pre-ai-edit" }),
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(201);
    const body = (await r.json()) as { id: string; reason: string };
    expect(body.reason).toBe("pre-ai-edit");
    const [inserted] = await db
      .select()
      .from(noteRevisions)
      .where(eq(noteRevisions.id, body.id));
    expect(inserted.reason).toBe("pre-ai-edit");
    expect(inserted.contentMd).toBe("pre ai body");
  });

  it("400 when reason = 'autosave'", async () => {
    const noteId = await mkNote(u.cookie, "Rev POST autosave reject");
    const r = await POST(
      req(`/api/notes/${noteId}/revisions`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ reason: "autosave" }),
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(400);
  });

  it("400 when reason is garbage", async () => {
    const noteId = await mkNote(u.cookie, "Rev POST garbage");
    const r = await POST(
      req(`/api/notes/${noteId}/revisions`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ reason: "garbage" }),
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(400);
  });

  it("401 when unauthenticated", async () => {
    const noteId = await mkNote(u.cookie, "Rev POST no auth");
    const r = await POST(
      req(`/api/notes/${noteId}/revisions`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(401);
  });

  it("404 when note not owned by user", async () => {
    const noteId = await mkNote(u.cookie, "Rev POST cross user");
    const r = await POST(
      req(`/api/notes/${noteId}/revisions`, {
        method: "POST",
        cookie: other.cookie,
        body: JSON.stringify({}),
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(404);
  });
});
