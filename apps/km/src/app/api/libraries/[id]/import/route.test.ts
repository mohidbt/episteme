import { afterAll, beforeAll, describe, expect, it } from "vitest";
import archiver from "archiver";
import { eq, and } from "drizzle-orm";
import { POST } from "./route";
import { POST as POST_LIB } from "../../route";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";
import {
  createTestUser,
  deleteTestUser,
  params,
  req,
  type TestUser,
} from "../../../_test-utils";
import { ensureMinIOReady } from "../../../_minio-setup";

async function buildZip(
  entries: Array<{ name: string; body: Buffer | string }>,
): Promise<Buffer> {
  const archive = archiver("zip", { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
  const done = new Promise<void>((resolve, reject) => {
    archive.on("end", resolve);
    archive.on("error", reject);
  });
  for (const e of entries) archive.append(e.body, { name: e.name });
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

function formRequest(
  url: string,
  form: FormData,
  cookie?: string,
): Request {
  const init: RequestInit & { cookie?: string } = {
    method: "POST",
    body: form,
  };
  if (cookie) init.cookie = cookie;
  return req(url, init);
}

let u: TestUser;
let other: TestUser;
let libraryId: number;

beforeAll(async () => {
  await ensureMinIOReady();
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "Import Lib" }),
    }),
  );
  libraryId = (await r.json()).id;
}, 60_000);

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("POST /api/libraries/:id/import", () => {
  it("401 unauthenticated", async () => {
    const form = new FormData();
    form.set("file", new File(["body"], "a.md", { type: "text/markdown" }));
    const r = await POST(
      formRequest(`/api/libraries/${libraryId}/import`, form),
      params({ id: String(libraryId) }),
    );
    expect(r.status).toBe(401);
  });

  it("400 non-numeric id", async () => {
    const form = new FormData();
    form.set("file", new File(["body"], "a.md", { type: "text/markdown" }));
    const r = await POST(
      formRequest(`/api/libraries/abc/import`, form, u.cookie),
      params({ id: "abc" }),
    );
    expect(r.status).toBe(400);
  });

  it("403 foreign library", async () => {
    const form = new FormData();
    form.set("file", new File(["body"], "a.md", { type: "text/markdown" }));
    const r = await POST(
      formRequest(`/api/libraries/${libraryId}/import`, form, other.cookie),
      params({ id: String(libraryId) }),
    );
    expect(r.status).toBe(403);
  });

  it("200 uploads a single .md and creates a note at the given folder_path", async () => {
    const form = new FormData();
    form.set(
      "file",
      new File(
        ['---\ntitle: "Quick Idea"\n---\n\nbody here'],
        "quick-idea.md",
        { type: "text/markdown" },
      ),
    );
    form.set("folder_path", "inbox/");
    const r = await POST(
      formRequest(`/api/libraries/${libraryId}/import`, form, u.cookie),
      params({ id: String(libraryId) }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.imported).toBe(1);

    const rows = await db
      .select()
      .from(notes)
      .where(
        and(
          eq(notes.libraryId, libraryId),
          eq(notes.slug, "quick-idea"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].folderPath).toBe("inbox/");
    expect(rows[0].title).toBe("Quick Idea");
    expect(rows[0].filename).toBe("quick-idea.md");
  });

  it("200 uploads a zip and returns counts", async () => {
    const zipBuf = await buildZip([
      {
        name: "Import Lib/notes/welcome.md",
        body: "# welcome body",
      },
      {
        name: "Import Lib/references/classics/smith2020.json",
        body: JSON.stringify({
          id: "smith2020",
          type: "article-journal",
          title: "Example",
        }),
      },
    ]);
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array(zipBuf)], "import.zip", {
        type: "application/zip",
      }),
    );
    const r = await POST(
      formRequest(`/api/libraries/${libraryId}/import`, form, u.cookie),
      params({ id: String(libraryId) }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.imported).toBe(2);
  }, 30_000);

  it("400 on path-traversal zip", async () => {
    const zipBuf = await buildZip([
      { name: "Import Lib/notes/../etc/passwd", body: "evil" },
    ]);
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array(zipBuf)], "evil.zip", {
        type: "application/zip",
      }),
    );
    const r = await POST(
      formRequest(`/api/libraries/${libraryId}/import`, form, u.cookie),
      params({ id: String(libraryId) }),
    );
    expect(r.status).toBe(400);
  });

  it("200 .md import with folderId sets note's folderId", async () => {
    // Create a real folder first so the FK constraint is satisfied
    const { POST: POST_FOLDER } = await import("../../../folders/route");
    const POST_LIB2 = POST_LIB;
    const libRes = await POST_LIB2(
      req("/api/libraries", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ name: "FolderIdLib" }),
      }),
    );
    const folderLibId: number = (await libRes.json()).id;

    const folderRes = await POST_FOLDER(
      req("/api/folders", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({
          libraryId: folderLibId,
          parentId: null,
          name: "ImportTarget",
        }),
      }),
    );
    expect(folderRes.status).toBe(201);
    const folderId: string = (await folderRes.json()).id;

    const form = new FormData();
    form.set(
      "file",
      new File(
        ['---\ntitle: "With FolderId"\n---\nbody'],
        "with-folderid.md",
        { type: "text/markdown" },
      ),
    );
    form.set("folderId", folderId);

    const r = await POST(
      formRequest(`/api/libraries/${folderLibId}/import`, form, u.cookie),
      params({ id: String(folderLibId) }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.imported).toBe(1);

    const rows = await db
      .select()
      .from(notes)
      .where(
        and(
          eq(notes.libraryId, folderLibId),
          eq(notes.slug, "with-folderid"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].folderId).toBe(folderId);
  });

  it("200 .md import without folderId leaves note's folderId null", async () => {
    const form = new FormData();
    form.set(
      "file",
      new File(
        ['---\ntitle: "No FolderId"\n---\nbody'],
        "no-folderid.md",
        { type: "text/markdown" },
      ),
    );
    // no folderId field
    const r = await POST(
      formRequest(`/api/libraries/${libraryId}/import`, form, u.cookie),
      params({ id: String(libraryId) }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.imported).toBe(1);

    const rows = await db
      .select()
      .from(notes)
      .where(
        and(
          eq(notes.libraryId, libraryId),
          eq(notes.slug, "no-folderid"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].folderId).toBeNull();
  });
});
