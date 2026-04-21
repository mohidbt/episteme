import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { GET, POST } from "./route";
import {
  DELETE as DEL_ID,
  GET as GET_ID,
  PATCH as PATCH_ID,
} from "./[id]/route";
import { POST as POST_LIB } from "../libraries/route";
import {
  createTestUser,
  deleteTestUser,
  params,
  req,
  type TestUser,
} from "../_test-utils";
import { db } from "@/lib/db";
import { notes, noteLinks, papers } from "@episteme/db/schema";
import { deriveCitationKey } from "@/lib/csl";

let u: TestUser;
let other: TestUser;
let libraryId: number;
let libraryId2: number;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name: "Refs Lib" }) }),
  );
  libraryId = (await r.json()).id;
  const r2 = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name: "Refs Lib 2" }) }),
  );
  libraryId2 = (await r2.json()).id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

let keyCounter = 0;
const uniqueKey = () => `key${Date.now()}${keyCounter++}`;
const refBody = (overrides: Record<string, unknown> = {}) => ({
  libraryId,
  citationKey: uniqueKey(),
  cslJson: { type: "article-journal", title: "Paper" },
  ...overrides,
});

describe("references", () => {
  it("401 no user", async () => {
    const r = await GET(req(`/api/references?libraryId=${libraryId}`));
    expect(r.status).toBe(401);
  });

  it("400 invalid citation key", async () => {
    const r = await POST(
      req("/api/references", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(refBody({ citationKey: "has space" })),
      }),
    );
    expect(r.status).toBe(400);
  });

  it("403 creating ref in other user's library", async () => {
    const r = await POST(
      req("/api/references", { method: "POST", cookie: other.cookie, body: JSON.stringify(refBody()) }),
    );
    expect(r.status).toBe(403);
  });

  it("golden path CRUD", async () => {
    const c = await POST(req("/api/references", { method: "POST", cookie: u.cookie, body: JSON.stringify(refBody()) }));
    expect(c.status).toBe(201);
    const ref = await c.json();

    const list = await GET(req(`/api/references?libraryId=${libraryId}`, { cookie: u.cookie }));
    const rows = await list.json();
    expect(rows.some((r: any) => r.id === ref.id)).toBe(true);

    const one = await GET_ID(req(`/api/references/${ref.id}`, { cookie: u.cookie }), params({ id: ref.id }));
    expect(one.status).toBe(200);

    const newKey = uniqueKey();
    const patched = await PATCH_ID(
      req(`/api/references/${ref.id}`, { method: "PATCH", cookie: u.cookie, body: JSON.stringify({ citationKey: newKey }) }),
      params({ id: ref.id }),
    );
    expect((await patched.json()).citationKey).toBe(newKey);

    const del = await DEL_ID(req(`/api/references/${ref.id}`, { method: "DELETE", cookie: u.cookie }), params({ id: ref.id }));
    expect(del.status).toBe(204);
  });

  it("ownership: other user cannot delete", async () => {
    const c = await POST(req("/api/references", { method: "POST", cookie: u.cookie, body: JSON.stringify(refBody()) }));
    const ref = await c.json();
    const r = await DEL_ID(
      req(`/api/references/${ref.id}`, { method: "DELETE", cookie: other.cookie }),
      params({ id: ref.id }),
    );
    expect(r.status).toBe(403);
  });
});

// ── Create from CSL (no citationKey) ────────────────────────────────────────

describe("references POST { cslJson } without citationKey", () => {
  it("derives citationKey from CSL", async () => {
    const csl = {
      id: "x1",
      type: "article-journal",
      title: "Quantum Entanglement in Practice",
      author: [{ family: "Ritter", given: "Sara" }],
      issued: { "date-parts": [[2021]] },
    };
    const r = await POST(
      req("/api/references", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, cslJson: csl }),
      }),
    );
    expect(r.status).toBe(201);
    const row = await r.json();
    expect(row.citationKey).toBe(deriveCitationKey(csl as any));
  });

  it("explicit citationKey override wins over derivation", async () => {
    const explicit = `explicit${Date.now()}`;
    const csl = {
      id: "x2",
      type: "article-journal",
      title: "Some Title",
      author: [{ family: "Smith" }],
      issued: { "date-parts": [[2020]] },
    };
    const r = await POST(
      req("/api/references", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, cslJson: csl, citationKey: explicit }),
      }),
    );
    expect(r.status).toBe(201);
    const row = await r.json();
    expect(row.citationKey).toBe(explicit);
  });
});

// ── Unique-collision handling ───────────────────────────────────────────────

describe("references citation_key_conflict", () => {
  it("409 on duplicate (libraryId, citationKey) — suggests key-2", async () => {
    const base = `dup${Date.now()}`;
    const first = await POST(
      req("/api/references", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, citationKey: base, cslJson: { id: base, type: "article-journal", title: "T" } }),
      }),
    );
    expect(first.status).toBe(201);

    const second = await POST(
      req("/api/references", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, citationKey: base, cslJson: { id: base, type: "article-journal", title: "T" } }),
      }),
    );
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body).toEqual({ error: "citation_key_conflict", suggestion: `${base}-2` });
  });

  it("409 on duplicate -N key increments N (foo-2 → foo-3)", async () => {
    const base = `inc${Date.now()}-2`;
    const first = await POST(
      req("/api/references", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, citationKey: base, cslJson: { id: base, type: "article-journal", title: "T" } }),
      }),
    );
    expect(first.status).toBe(201);

    const second = await POST(
      req("/api/references", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, citationKey: base, cslJson: { id: base, type: "article-journal", title: "T" } }),
      }),
    );
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.suggestion).toBe(base.replace(/-2$/, "-3"));
  });

  it("cross-library: same citationKey in two libraries both succeed", async () => {
    const key = `xl${Date.now()}`;
    const a = await POST(
      req("/api/references", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, citationKey: key, cslJson: { id: key, type: "article-journal", title: "T" } }),
      }),
    );
    expect(a.status).toBe(201);
    const b = await POST(
      req("/api/references", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId: libraryId2, citationKey: key, cslJson: { id: key, type: "article-journal", title: "T" } }),
      }),
    );
    expect(b.status).toBe(201);
  });
});

// ── DOI path (mocked CrossRef) ──────────────────────────────────────────────

describe("references POST { doi }", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("201 with fetched CSL on DOI hit", async () => {
    const vaswaniMessage = {
      DOI: "10.48550/arXiv.1706.03762",
      type: "posted-content",
      title: ["Attention Is All You Need"],
      author: [{ family: "Vaswani", given: "Ashish", sequence: "first", affiliation: [] }],
      issued: { "date-parts": [[2017, 6, 12]] },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        json: async () => ({ status: "ok", message: vaswaniMessage }),
      }),
    );

    const r = await POST(
      req("/api/references", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, doi: "10.48550/arXiv.1706.03762" }),
      }),
    );
    expect(r.status).toBe(201);
    const row = await r.json();
    expect(row.cslJson.author[0].family).toBe("Vaswani");
    expect(row.citationKey.startsWith("vaswani")).toBe(true);
  });

  it("404 when DOI not found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404 }));
    const r = await POST(
      req("/api/references", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, doi: "10.999/nonexistent" }),
      }),
    );
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(body.error).toBe("doi_not_found");
  });
});

// ── GET ?q= search ──────────────────────────────────────────────────────────

describe("references GET ?q=", () => {
  it("filters on citationKey OR cslJson->>'title' (case-insensitive)", async () => {
    const key1 = `att${Date.now()}`;
    // title contains "attention", key doesn't
    const a = await POST(
      req("/api/references", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({
          libraryId,
          citationKey: key1,
          cslJson: { id: key1, type: "article-journal", title: "An Attention Study" },
        }),
      }),
    );
    expect(a.status).toBe(201);

    // key contains "attention", title doesn't
    const key2 = `attention${Date.now()}`;
    const b = await POST(
      req("/api/references", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({
          libraryId,
          citationKey: key2,
          cslJson: { id: key2, type: "article-journal", title: "Totally Unrelated" },
        }),
      }),
    );
    expect(b.status).toBe(201);

    // neither key nor title matches
    const key3 = `other${Date.now()}`;
    const c = await POST(
      req("/api/references", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({
          libraryId,
          citationKey: key3,
          cslJson: { id: key3, type: "article-journal", title: "Unmatched" },
        }),
      }),
    );
    expect(c.status).toBe(201);

    const list = await GET(
      req(`/api/references?libraryId=${libraryId}&q=attention`, { cookie: u.cookie }),
    );
    const rows = (await list.json()) as Array<{ citationKey: string }>;
    const returnedKeys = rows.map((r) => r.citationKey);
    expect(returnedKeys).toContain(key1);
    expect(returnedKeys).toContain(key2);
    expect(returnedKeys).not.toContain(key3);
  });
});

// ── PATCH { paperId } attaches/detaches a paper ─────────────────────────────

describe("references PATCH { paperId }", () => {
  it("attaches to paper, then detaches with null", async () => {
    const [paper] = await db
      .insert(papers)
      .values({
        libraryId,
        userId: u.id,
        filename: `attach-${Date.now()}.pdf`,
        title: "Attach Target",
      })
      .returning({ id: papers.id });

    const c = await POST(
      req("/api/references", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(refBody()),
      }),
    );
    expect(c.status).toBe(201);
    const ref = await c.json();

    const attach = await PATCH_ID(
      req(`/api/references/${ref.id}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ paperId: paper.id }),
      }),
      params({ id: ref.id }),
    );
    expect(attach.status).toBe(200);
    expect((await attach.json()).paperId).toBe(paper.id);

    const got = await GET_ID(
      req(`/api/references/${ref.id}`, { cookie: u.cookie }),
      params({ id: ref.id }),
    );
    expect((await got.json()).paperId).toBe(paper.id);

    const detach = await PATCH_ID(
      req(`/api/references/${ref.id}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ paperId: null }),
      }),
      params({ id: ref.id }),
    );
    expect(detach.status).toBe(200);
    expect((await detach.json()).paperId).toBe(null);
  });
});

// ── DELETE cascades noteLinks ───────────────────────────────────────────────

describe("references DELETE cascades noteLinks", () => {
  it("removes note_links with target_kind=reference pointing at the deleted ref", async () => {
    const key = `cascade${Date.now()}`;
    const c = await POST(
      req("/api/references", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({
          libraryId,
          citationKey: key,
          cslJson: { id: key, type: "article-journal", title: "Cascade Ref" },
        }),
      }),
    );
    expect(c.status).toBe(201);
    const ref = await c.json();

    const [note] = await db
      .insert(notes)
      .values({
        libraryId,
        userId: u.id,
        title: "Linking note",
        slug: `linking-note-${Math.random().toString(36).slice(2, 8)}`,
      })
      .returning({ id: notes.id });

    const [link] = await db
      .insert(noteLinks)
      .values({
        sourceNoteId: note.id,
        targetKind: "reference",
        targetId: ref.id,
        targetTitleRaw: "[[Cascade Ref]]",
      })
      .returning({ id: noteLinks.id });

    const before = await db
      .select({ id: noteLinks.id })
      .from(noteLinks)
      .where(and(eq(noteLinks.targetKind, "reference"), eq(noteLinks.targetId, ref.id)));
    expect(before.some((r) => r.id === link.id)).toBe(true);

    const del = await DEL_ID(
      req(`/api/references/${ref.id}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: ref.id }),
    );
    expect(del.status).toBe(204);

    const after = await db
      .select({ id: noteLinks.id })
      .from(noteLinks)
      .where(and(eq(noteLinks.targetKind, "reference"), eq(noteLinks.targetId, ref.id)));
    expect(after.length).toBe(0);
  });
});
