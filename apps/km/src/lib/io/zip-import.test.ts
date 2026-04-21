import { afterAll, beforeAll, describe, expect, it } from "vitest";
import archiver from "archiver";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { libraries, notes, references_, papers } from "@episteme/db/schema";
import { storage, paperSourceKey } from "@/lib/storage";
import {
  createTestUser,
  deleteTestUser,
  type TestUser,
} from "../../app/api/_test-utils";
import { ensureMinIOReady } from "../../app/api/_minio-setup";
import { importLibraryZip } from "./zip-import";

const PDF_BYTES = Buffer.from("%PDF-1.4 tiny crispr content\n%%EOF", "utf8");

interface ZipSpec {
  entries: Array<
    | { type: "file"; name: string; body: Buffer | string }
    | { type: "directory"; name: string }
  >;
}

async function buildZip(spec: ZipSpec): Promise<Buffer> {
  const archive = archiver("zip", { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
  const done = new Promise<void>((resolve, reject) => {
    archive.on("end", resolve);
    archive.on("error", reject);
  });
  for (const e of spec.entries) {
    if (e.type === "directory") {
      // archiver accepts null for directory entries but its types don't reflect that.
      archive.append(null as unknown as string, {
        name: e.name.endsWith("/") ? e.name : e.name + "/",
      });
    } else {
      archive.append(e.body, { name: e.name });
    }
  }
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

let u: TestUser;
let libraryId: number;
const createdPaperIds: string[] = [];

beforeAll(async () => {
  await ensureMinIOReady();
  u = await createTestUser();
  const [lib] = await db
    .insert(libraries)
    .values({ userId: u.id, name: "MyLibrary" })
    .returning();
  libraryId = lib.id;
}, 60_000);

afterAll(async () => {
  for (const id of createdPaperIds) {
    await storage.deleteObject(paperSourceKey(id)).catch(() => {});
  }
  await deleteTestUser(u.id);
});

describe("importLibraryZip", () => {
  it("imports notes, references, and papers at the expected folder paths", async () => {
    const zipBuf = await buildZip({
      entries: [
        { type: "directory", name: "MyLibrary/" },
        { type: "directory", name: "MyLibrary/notes/" },
        { type: "directory", name: "MyLibrary/notes/inbox/" },
        {
          type: "file",
          name: "MyLibrary/notes/inbox/quick-idea.md",
          body: "quick idea body",
        },
        {
          type: "file",
          name: "MyLibrary/notes/projects/phd/chapter-2.md",
          body: '---\ntitle: "Chapter 2: Methods"\n---\n\nchapter body',
        },
        {
          type: "file",
          name: "MyLibrary/notes/welcome.md",
          body: "# Welcome\n\nhello",
        },
        {
          type: "file",
          name: "MyLibrary/references/classics/vaswani2017attention.json",
          body: JSON.stringify({
            id: "vaswani2017attention",
            type: "article-journal",
            title: "Attention Is All You Need",
          }),
        },
        {
          type: "file",
          name: "MyLibrary/papers/biology/crispr-paper.pdf",
          body: PDF_BYTES,
        },
      ],
    });

    const result = await importLibraryZip(u.id, libraryId, zipBuf);
    expect(result.imported).toBe(5);

    // Notes: three rows with correct folder_path and title resolution.
    const noteRows = await db
      .select()
      .from(notes)
      .where(and(eq(notes.libraryId, libraryId), eq(notes.userId, u.id)));
    expect(noteRows).toHaveLength(3);
    const byFolder = new Map(noteRows.map((n) => [n.folderPath, n]));
    expect(byFolder.get("")).toBeTruthy();
    expect(byFolder.get("inbox/")).toBeTruthy();
    expect(byFolder.get("projects/phd/")).toBeTruthy();

    // Frontmatter title on chapter-2.md beats filename.
    const chapter = byFolder.get("projects/phd/")!;
    expect(chapter.title).toBe("Chapter 2: Methods");
    expect(chapter.filename).toBe("chapter-2.md");
    // Body only — frontmatter stripped.
    expect(chapter.contentMd).toBe("\nchapter body");

    const welcome = byFolder.get("")!;
    expect(welcome.title).toBe("welcome");
    expect(welcome.slug).toBe("welcome");

    const inbox = byFolder.get("inbox/")!;
    expect(inbox.slug).toBe("quick-idea");
    expect(inbox.title).toBe("quick-idea");

    // Reference: folder, citation_key, CSL JSON round-trip.
    const refRows = await db
      .select()
      .from(references_)
      .where(and(eq(references_.libraryId, libraryId), eq(references_.userId, u.id)));
    expect(refRows).toHaveLength(1);
    expect(refRows[0].folderPath).toBe("classics/");
    expect(refRows[0].citationKey).toBe("vaswani2017attention");
    expect((refRows[0].cslJson as { title?: string }).title).toBe("Attention Is All You Need");

    // Paper row + MinIO object.
    const paperRows = await db
      .select()
      .from(papers)
      .where(and(eq(papers.libraryId, libraryId), eq(papers.userId, u.id)));
    expect(paperRows).toHaveLength(1);
    expect(paperRows[0].folderPath).toBe("biology/");
    expect(paperRows[0].filename).toBe("crispr-paper.pdf");
    // extractMetadata on a non-PDF payload falls back to filename-derived title.
    expect(paperRows[0].title).toBe("crispr-paper");
    createdPaperIds.push(paperRows[0].id);

    // MinIO object exists.
    const headUrl = await storage.getPresignedHead(paperSourceKey(paperRows[0].id), 30);
    const head = await fetch(headUrl, { method: "HEAD" });
    expect(head.status).toBe(200);
  }, 60_000);

  it("rejects zips with path-traversal entries", async () => {
    const zipBuf = await buildZip({
      entries: [
        {
          type: "file",
          name: "MyLibrary/notes/../etc/passwd",
          body: "root:x:0:0:",
        },
      ],
    });
    await expect(importLibraryZip(u.id, libraryId, zipBuf)).rejects.toMatchObject({
      code: "path_traversal",
    });
  });

  it("re-import with existing slug does not overwrite; new note gets suffix", async () => {
    // First import seeded welcome (slug 'welcome') — run another with same slug.
    const before = await db
      .select()
      .from(notes)
      .where(and(eq(notes.libraryId, libraryId), eq(notes.slug, "welcome")));
    expect(before).toHaveLength(1);
    const beforeBody = before[0].contentMd;

    const zipBuf = await buildZip({
      entries: [
        {
          type: "file",
          name: "MyLibrary/notes/welcome.md",
          body: "# New Welcome\n\nsecond import",
        },
      ],
    });
    const result = await importLibraryZip(u.id, libraryId, zipBuf);
    expect(result.imported).toBe(1);

    const after = await db
      .select()
      .from(notes)
      .where(and(eq(notes.userId, u.id), eq(notes.title, "welcome")));
    // Two rows now: welcome + welcome-2
    const slugs = after.map((n) => n.slug).sort();
    expect(slugs).toEqual(["welcome", "welcome-2"]);

    // Original body untouched.
    const original = after.find((n) => n.slug === "welcome")!;
    expect(original.contentMd).toBe(beforeBody);
  });

  it("skips directory-only entries without crashing", async () => {
    const zipBuf = await buildZip({
      entries: [
        { type: "directory", name: "MyLibrary/notes/empty-folder/" },
      ],
    });
    const result = await importLibraryZip(u.id, libraryId, zipBuf);
    expect(result.imported).toBe(0);
  });
});
