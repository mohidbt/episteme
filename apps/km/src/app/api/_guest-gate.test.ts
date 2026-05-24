/**
 * K9 follow-up: guest gate on write surfaces.
 *
 * Better Auth's anonymous-sign-in flow gives guests a real userId; cookie-only
 * authz can't tell them apart from real users. These tests pin down that every
 * write route flagged by codex returns 403 `guest_forbidden` for an anonymous
 * session while still serving real users normally.
 *
 * The "200 for real user" assertion uses `not.toBe(403)` (and not 401) — the
 * point here is the gate, not the happy-path semantics of each route (which
 * have their own dedicated test files).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { libraries, papers, notes, references_ } from "@episteme/db/schema";
import {
  createAnonTestUser,
  createTestUser,
  deleteTestUser,
  params,
  req,
  type TestUser,
} from "./_test-utils";

import { POST as POST_PAPERS } from "./papers/route";
import { POST as POST_ASSETS } from "./assets/route";
import { POST as POST_NOTES } from "./notes/route";
import { POST as POST_REFS } from "./references/route";
import { POST as POST_LIBS } from "./libraries/route";
import { POST as POST_FOLDERS } from "./folders/route";
import { POST as POST_PAPERSETS } from "./papersets/route";
import { POST as POST_USER_HL } from "./user-highlights/route";
import { POST as POST_PAPER_HL } from "./paper-highlights/route";
import { PATCH as PATCH_NOTE } from "./notes/[id]/route";
import { PATCH as PATCH_REF } from "./references/[id]/route";

let realUser: TestUser;
let anonUser: TestUser;
let realLibraryId: number;
let realPaperId: string;
let realNoteId: string;
let realReferenceId: string;

beforeAll(async () => {
  // No ensureMinIOReady() — fixtures are seeded with direct DB inserts and
  // none of the routes under test stream S3 bytes (papers returns a presigned
  // URL; assets/papersets are pure DB writes for the gate path we exercise).
  realUser = await createTestUser();
  anonUser = await createAnonTestUser();

  // Seed real-user library + a paper, note, and reference for PATCH tests.
  // Direct DB inserts (not API) so this fixture is independent of the routes
  // under test.
  const [lib] = await db
    .insert(libraries)
    .values({ userId: realUser.id, name: "Gate Lib" })
    .returning();
  realLibraryId = lib.id;

  const [paper] = await db
    .insert(papers)
    .values({
      libraryId: lib.id,
      userId: realUser.id,
      filename: "gate.pdf",
      title: "gate",
      sizeBytes: 1024,
    })
    .returning();
  realPaperId = paper.id;

  const [note] = await db
    .insert(notes)
    .values({
      libraryId: lib.id,
      userId: realUser.id,
      title: "Gate Note",
      slug: `gate-note-${Date.now()}`,
      folderPath: "",
    })
    .returning();
  realNoteId = note.id;

  const [ref] = await db
    .insert(references_)
    .values({
      libraryId: lib.id,
      userId: realUser.id,
      folderPath: "",
      citationKey: `gateref${Date.now()}`,
      cslJson: { id: "1", type: "article-journal", title: "x" },
    })
    .returning();
  realReferenceId = ref.id;
}, 60_000);

afterAll(async () => {
  await deleteTestUser(realUser.id);
  await deleteTestUser(anonUser.id);
});

type GateCase = {
  name: string;
  call: (cookie: string) => Promise<Response>;
};

const cases: GateCase[] = [
  {
    name: "POST /api/papers",
    call: (cookie) =>
      POST_PAPERS(
        req("/api/papers", {
          method: "POST",
          cookie,
          body: JSON.stringify({
            libraryId: realLibraryId,
            filename: "x.pdf",
            contentType: "application/pdf",
            sizeBytes: 1024,
          }),
        }),
      ),
  },
  {
    name: "POST /api/assets",
    call: (cookie) =>
      POST_ASSETS(
        req("/api/assets", {
          method: "POST",
          cookie,
          body: JSON.stringify({
            libraryId: realLibraryId,
            filename: "x.png",
            contentType: "image/png",
            sizeBytes: 1024,
          }),
        }),
      ),
  },
  {
    name: "POST /api/notes",
    call: (cookie) =>
      POST_NOTES(
        req("/api/notes", {
          method: "POST",
          cookie,
          body: JSON.stringify({
            libraryId: realLibraryId,
            title: "x",
            folderPath: "",
          }),
        }),
      ),
  },
  {
    name: "POST /api/references",
    call: (cookie) =>
      POST_REFS(
        req("/api/references", {
          method: "POST",
          cookie,
          body: JSON.stringify({
            libraryId: realLibraryId,
            folderPath: "",
            citationKey: `gk${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
            cslJson: { id: "1", type: "article-journal", title: "x" },
          }),
        }),
      ),
  },
  {
    name: "POST /api/libraries",
    call: (cookie) =>
      POST_LIBS(
        req("/api/libraries", {
          method: "POST",
          cookie,
          body: JSON.stringify({ name: "GateRealLib" }),
        }),
      ),
  },
  {
    name: "POST /api/folders",
    call: (cookie) =>
      POST_FOLDERS(
        req("/api/folders", {
          method: "POST",
          cookie,
          body: JSON.stringify({
            libraryId: realLibraryId,
            parentId: null,
            name: `gate-${Date.now()}`,
          }),
        }),
      ),
  },
  {
    name: "POST /api/papersets",
    call: (cookie) =>
      POST_PAPERSETS(
        req("/api/papersets", {
          method: "POST",
          cookie,
          body: JSON.stringify({
            filename: `gate-${Date.now()}.csv`,
            columns: [{ name: "c1", description: "d" }],
            rowRefs: [],
            content: "c1\nx",
          }),
        }),
      ),
  },
  {
    name: "POST /api/user-highlights",
    call: (cookie) =>
      POST_USER_HL(
        req("/api/user-highlights", {
          method: "POST",
          cookie,
          body: JSON.stringify({
            paperId: realPaperId,
            pageNumber: 1,
            textContent: "hello",
            startOffset: 0,
            endOffset: 5,
          }),
        }),
      ),
  },
  {
    name: "POST /api/paper-highlights",
    call: (cookie) =>
      POST_PAPER_HL(
        req("/api/paper-highlights", {
          method: "POST",
          cookie,
          body: JSON.stringify([
            {
              paperId: realPaperId,
              page: 1,
              quote: "hello",
            },
          ]),
        }),
      ),
  },
  {
    name: "PATCH /api/notes/[id]",
    call: (cookie) =>
      PATCH_NOTE(
        req(`/api/notes/${realNoteId}`, {
          method: "PATCH",
          cookie,
          body: JSON.stringify({ title: "renamed" }),
        }),
        params({ id: realNoteId }),
      ),
  },
  {
    name: "PATCH /api/references/[id]",
    call: (cookie) =>
      PATCH_REF(
        req(`/api/references/${realReferenceId}`, {
          method: "PATCH",
          cookie,
          body: JSON.stringify({ citationKey: `gk2${Date.now()}` }),
        }),
        params({ id: realReferenceId }),
      ),
  },
];

describe("K9 guest gate — write routes refuse anonymous sessions", () => {
  for (const c of cases) {
    it(`${c.name} returns 403 guest_forbidden for anon`, async () => {
      const r = await c.call(anonUser.cookie);
      expect(r.status).toBe(403);
      const body = await r.json();
      expect(body.error).toBe("guest_forbidden");
    });

    it(`${c.name} does NOT return 403 guest_forbidden for real user`, async () => {
      const r = await c.call(realUser.cookie);
      // Each route has its own happy-path tests; here we only assert that
      // a real user is not gated out by the guest check (which would be
      // 403 + error="guest_forbidden"). The route may legitimately return
      // 201/200/400/409 depending on body validity — but never the gate.
      if (r.status === 403) {
        const body = await r.clone().json();
        expect(body.error).not.toBe("guest_forbidden");
      }
      expect(r.status).not.toBe(401);
    });
  }
});
