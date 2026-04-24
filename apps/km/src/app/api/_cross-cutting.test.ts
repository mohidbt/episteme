import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { papers, references_, notes, noteLinks, libraries } from "@episteme/db/schema";
import { POST as POST_LIB } from "./libraries/route";
import { DELETE as DEL_LIB } from "./libraries/[id]/route";
import { POST as POST_PAPER } from "./papers/route";
import { DELETE as DEL_PAPER } from "./papers/[id]/route";
import { POST as POST_REF } from "./references/route";
import { POST as POST_NOTE } from "./notes/route";
import { POST as POST_LINK } from "./notes/[id]/links/route";
import { createTestUser, deleteTestUser, params, req, type TestUser } from "./_test-utils";
import { ensureMinIOReady } from "./_minio-setup";
import { getTrashFolderId } from "@/lib/folders-server";

let userA: TestUser;
let userB: TestUser;

beforeAll(async () => {
  await ensureMinIOReady();
  userA = await createTestUser();
  userB = await createTestUser();
}, 60_000);

afterAll(async () => {
  await deleteTestUser(userA.id);
  await deleteTestUser(userB.id);
});

async function createLib(u: TestUser, name = "Lib"): Promise<number> {
  const r = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name }) }),
  );
  return (await r.json()).id;
}

describe("cascade delete library", () => {
  it("removes papers, references, notes, and note_links", async () => {
    const libId = await createLib(userA, "Cascade Lib");

    const paperR = await POST_PAPER(
      req("/api/papers", {
        method: "POST",
        cookie: userA.cookie,
        body: JSON.stringify({
          libraryId: libId,
          filename: "c.pdf",
          contentType: "application/pdf",
          sizeBytes: 1024,
        }),
      }),
    );
    const { paperId } = await paperR.json();

    const refR = await POST_REF(
      req("/api/references", {
        method: "POST",
        cookie: userA.cookie,
        body: JSON.stringify({
          libraryId: libId,
          citationKey: `cas${Date.now()}`,
          cslJson: { type: "article-journal", title: "c" },
        }),
      }),
    );
    const ref = await refR.json();

    const noteR = await POST_NOTE(
      req("/api/notes", {
        method: "POST",
        cookie: userA.cookie,
        body: JSON.stringify({ libraryId: libId, title: "Cascade Note" }),
      }),
    );
    const note = await noteR.json();

    const linkR = await POST_LINK(
      req(`/api/notes/${note.id}/links`, {
        method: "POST",
        cookie: userA.cookie,
        body: JSON.stringify({ targetKind: "note", targetTitleRaw: "X" }),
      }),
      params({ id: note.id }),
    );
    const link = await linkR.json();

    const del = await DEL_LIB(
      req(`/api/libraries/${libId}`, { method: "DELETE", cookie: userA.cookie }),
      params({ id: String(libId) }),
    );
    expect(del.status).toBe(204);

    const libRows = await db.select().from(libraries).where(eq(libraries.id, libId));
    expect(libRows.length).toBe(0);

    const paperRows = await db.select().from(papers).where(eq(papers.id, paperId));
    expect(paperRows.length).toBe(0);

    const refRows = await db.select().from(references_).where(eq(references_.id, ref.id));
    expect(refRows.length).toBe(0);

    const noteRows = await db.select().from(notes).where(eq(notes.id, note.id));
    expect(noteRows.length).toBe(0);

    const linkRows = await db.select().from(noteLinks).where(eq(noteLinks.id, link.id));
    expect(linkRows.length).toBe(0);
  });
});

describe("paper delete sets reference.paperId to null", () => {
  it("reference survives with paperId null", async () => {
    const libId = await createLib(userA, "Paper Del Lib");

    const paperR = await POST_PAPER(
      req("/api/papers", {
        method: "POST",
        cookie: userA.cookie,
        body: JSON.stringify({
          libraryId: libId,
          filename: "p.pdf",
          contentType: "application/pdf",
          sizeBytes: 1024,
        }),
      }),
    );
    const { paperId } = await paperR.json();

    const refR = await POST_REF(
      req("/api/references", {
        method: "POST",
        cookie: userA.cookie,
        body: JSON.stringify({
          libraryId: libId,
          citationKey: `pd${Date.now()}`,
          cslJson: { type: "article-journal" },
          paperId,
        }),
      }),
    );
    const ref = await refR.json();
    expect(ref.paperId).toBe(paperId);

    // Move to trash before permanent delete (guard requirement).
    const trashId = await getTrashFolderId(libId, userA.id);
    await db.update(papers).set({ folderId: trashId }).where(eq(papers.id, paperId));

    const del = await DEL_PAPER(
      req(`/api/papers/${paperId}`, { method: "DELETE", cookie: userA.cookie }),
      params({ id: paperId }),
    );
    expect(del.status).toBe(204);

    const refRows = await db.select().from(references_).where(eq(references_.id, ref.id));
    expect(refRows.length).toBe(1);
    expect(refRows[0].paperId).toBe(null);
  });
});

describe("polymorphic note_links", () => {
  it("accepts all 3 target kinds and unresolved wikilinks", async () => {
    const libId = await createLib(userA, "Poly Lib");

    const srcNote = await (await POST_NOTE(
      req("/api/notes", {
        method: "POST",
        cookie: userA.cookie,
        body: JSON.stringify({ libraryId: libId, title: "Source" }),
      }),
    )).json();

    const tgtNote = await (await POST_NOTE(
      req("/api/notes", {
        method: "POST",
        cookie: userA.cookie,
        body: JSON.stringify({ libraryId: libId, title: "TargetNote" }),
      }),
    )).json();

    const tgtPaper = await (await POST_PAPER(
      req("/api/papers", {
        method: "POST",
        cookie: userA.cookie,
        body: JSON.stringify({
          libraryId: libId,
          filename: "t.pdf",
          contentType: "application/pdf",
          sizeBytes: 1024,
        }),
      }),
    )).json();

    const tgtRef = await (await POST_REF(
      req("/api/references", {
        method: "POST",
        cookie: userA.cookie,
        body: JSON.stringify({
          libraryId: libId,
          citationKey: `pk${Date.now()}`,
          cslJson: {},
        }),
      }),
    )).json();

    const cases = [
      { targetKind: "note", targetId: tgtNote.id, targetTitleRaw: "TargetNote" },
      { targetKind: "paper", targetId: tgtPaper.paperId, targetTitleRaw: "T" },
      { targetKind: "reference", targetId: tgtRef.id, targetTitleRaw: "ref" },
      { targetKind: "note", targetId: null, targetTitleRaw: "Unresolved Thing" },
    ];

    for (const c of cases) {
      const r = await POST_LINK(
        req(`/api/notes/${srcNote.id}/links`, {
          method: "POST",
          cookie: userA.cookie,
          body: JSON.stringify(c),
        }),
        params({ id: srcNote.id }),
      );
      expect(r.status).toBe(201);
    }

    const linkRows = await db
      .select()
      .from(noteLinks)
      .where(eq(noteLinks.sourceNoteId, srcNote.id));
    expect(linkRows.length).toBe(4);
    const kinds = linkRows.map((l) => l.targetKind).sort();
    expect(kinds).toEqual(["note", "note", "paper", "reference"]);
    expect(linkRows.some((l) => l.targetId === null && l.targetTitleRaw === "Unresolved Thing")).toBe(true);
  });
});

describe("cross-library ownership on POST", () => {
  it("rejects papers/references/notes targeting another user's library", async () => {
    const libB = await createLib(userB, "B Lib");

    const paperR = await POST_PAPER(
      req("/api/papers", {
        method: "POST",
        cookie: userA.cookie,
        body: JSON.stringify({
          libraryId: libB,
          filename: "x.pdf",
          contentType: "application/pdf",
          sizeBytes: 1024,
        }),
      }),
    );
    expect([403, 404]).toContain(paperR.status);

    const refR = await POST_REF(
      req("/api/references", {
        method: "POST",
        cookie: userA.cookie,
        body: JSON.stringify({
          libraryId: libB,
          citationKey: `xl${Date.now()}`,
          cslJson: {},
        }),
      }),
    );
    expect([403, 404]).toContain(refR.status);

    const noteR = await POST_NOTE(
      req("/api/notes", {
        method: "POST",
        cookie: userA.cookie,
        body: JSON.stringify({ libraryId: libB, title: "X-Note" }),
      }),
    );
    expect([403, 404]).toContain(noteR.status);
  });
});

describe("folder_path default and listing", () => {
  it("defaults to empty string and is filterable", async () => {
    const libId = await createLib(userA, "Folder Lib");

    const noteR = await POST_NOTE(
      req("/api/notes", {
        method: "POST",
        cookie: userA.cookie,
        body: JSON.stringify({ libraryId: libId, title: "Root Note" }),
      }),
    );
    const note = await noteR.json();
    expect(note.folderPath).toBe("");

    const { GET: GET_NOTES } = await import("./notes/route");

    const emptyList = await GET_NOTES(
      req(`/api/notes?libraryId=${libId}&folderPath=`, { cookie: userA.cookie }),
    );
    const emptyRows = await emptyList.json();
    expect(emptyRows.some((n: any) => n.id === note.id)).toBe(true);

    const otherList = await GET_NOTES(
      req(`/api/notes?libraryId=${libId}&folderPath=other/`, { cookie: userA.cookie }),
    );
    const otherRows = await otherList.json();
    expect(otherRows.some((n: any) => n.id === note.id)).toBe(false);
  });
});
