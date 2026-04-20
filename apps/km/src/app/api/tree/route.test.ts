import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "./route";
import { POST as POST_LIB } from "../libraries/route";
import { POST as POST_PAPER } from "../papers/route";
import { POST as POST_REF } from "../references/route";
import { POST as POST_NOTE } from "../notes/route";
import {
  createTestUser,
  deleteTestUser,
  req,
  type TestUser,
} from "../_test-utils";

let u: TestUser;
let other: TestUser;
let libraryId: number;
let libraryName: string;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "Tree Lib" }),
    }),
  );
  const lib = await r.json();
  libraryId = lib.id;
  libraryName = lib.name;

  // 2 papers
  await POST_PAPER(
    req("/api/papers", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({
        libraryId,
        filename: "p1.pdf",
        contentType: "application/pdf",
        sizeBytes: 1024,
        folderPath: "",
      }),
    }),
  );
  await POST_PAPER(
    req("/api/papers", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({
        libraryId,
        filename: "p2.pdf",
        contentType: "application/pdf",
        sizeBytes: 1024,
        folderPath: "biology/",
      }),
    }),
  );

  // 2 references: one with cslJson.title, one without (to verify fallback)
  await POST_REF(
    req("/api/references", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({
        libraryId,
        citationKey: "smith2020",
        cslJson: { title: "Smith 2020 — Real Title" },
        folderPath: "",
      }),
    }),
  );
  await POST_REF(
    req("/api/references", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({
        libraryId,
        citationKey: "jones2021",
        folderPath: "",
      }),
    }),
  );

  // 3 notes
  await POST_NOTE(
    req("/api/notes", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ libraryId, title: "Root Note", folderPath: "" }),
    }),
  );
  await POST_NOTE(
    req("/api/notes", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ libraryId, title: "Inbox Note", folderPath: "inbox/" }),
    }),
  );
  await POST_NOTE(
    req("/api/notes", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ libraryId, title: "Phd Note", folderPath: "projects/phd/" }),
    }),
  );
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

const AGENT_ITEMS = [
  { kind: "skills", label: "skills.md" },
  { kind: "memory", label: "memory.md" },
  { kind: "settings", label: "settings.json" },
];

describe("tree", () => {
  it("401 no user", async () => {
    const r = await GET(req(`/api/tree?libraryId=${libraryId}`));
    expect(r.status).toBe(401);
  });

  it("400 missing libraryId", async () => {
    const r = await GET(req(`/api/tree`, { cookie: u.cookie }));
    expect(r.status).toBe(400);
  });

  it("404 library owned by another user", async () => {
    const r = await GET(req(`/api/tree?libraryId=${libraryId}`, { cookie: other.cookie }));
    expect(r.status).toBe(404);
  });

  it("returns 4-section shape", async () => {
    const r = await GET(req(`/api/tree?libraryId=${libraryId}`, { cookie: u.cookie }));
    expect(r.status).toBe(200);
    const body = await r.json();

    expect(body.library.id).toBe(libraryId);
    expect(body.library.name).toBe(libraryName);

    expect(body.sections.papers.items).toHaveLength(2);
    const paperFolders = body.sections.papers.items.map((x: any) => x.folder_path).sort();
    expect(paperFolders).toEqual(["", "biology/"]);

    expect(body.sections.references.items).toHaveLength(2);
    const refs = body.sections.references.items;
    const smith = refs.find((r: any) => r.citation_key === "smith2020");
    const jones = refs.find((r: any) => r.citation_key === "jones2021");
    expect(smith).toBeDefined();
    expect(smith.title).toBe("Smith 2020 — Real Title");
    expect(smith.citation_key).toBe("smith2020");
    expect(jones).toBeDefined();
    expect(jones.title).toBe("jones2021");
    expect(jones.citation_key).toBe("jones2021");

    expect(body.sections.notes.items).toHaveLength(3);
    for (const n of body.sections.notes.items) {
      expect(typeof n.slug).toBe("string");
      expect(n.slug.length).toBeGreaterThan(0);
    }
    const noteFolders = body.sections.notes.items.map((x: any) => x.folder_path).sort();
    expect(noteFolders).toEqual(["", "inbox/", "projects/phd/"]);

    expect(body.sections.agent.items).toEqual(AGENT_ITEMS);
  });
});
