import { afterAll, beforeAll, describe, expect, it } from "vitest";
import unzipper from "unzipper";
import { db } from "@/lib/db";
import { libraries, notes, references_, papers } from "@episteme/db/schema";
import { storage, paperSourceKey } from "@/lib/storage";
import {
  createTestUser,
  deleteTestUser,
  type TestUser,
} from "../../app/api/_test-utils";
import { ensureMinIOReady } from "../../app/api/_minio-setup";
import { exportLibraryZip } from "./zip-export";

let u: TestUser;
let libraryId: number;
let libName: string;
let paperId: string;
const PDF_BYTES = Buffer.from("%PDF-1.4 tiny crispr content\n%%EOF", "utf8");

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function zipEntries(
  buf: Buffer,
): Promise<Map<string, Buffer>> {
  const dir = await unzipper.Open.buffer(buf);
  const out = new Map<string, Buffer>();
  for (const f of dir.files) {
    if (f.type === "Directory") continue;
    out.set(f.path, await f.buffer());
  }
  return out;
}

beforeAll(async () => {
  await ensureMinIOReady();
  u = await createTestUser();
  libName = "MyLibrary";
  const [lib] = await db
    .insert(libraries)
    .values({ userId: u.id, name: libName })
    .returning();
  libraryId = lib.id;

  await db.insert(notes).values([
    {
      libraryId,
      userId: u.id,
      folderPath: "",
      slug: "welcome",
      title: "Welcome",
      contentMd: "# Welcome\n\nHello.",
    },
    {
      libraryId,
      userId: u.id,
      folderPath: "inbox/",
      slug: "quick-idea",
      title: "Quick Idea",
      contentMd: "idea body",
    },
    {
      libraryId,
      userId: u.id,
      folderPath: "projects/phd/",
      slug: "chapter-2",
      title: "Chapter 2: Methods",
      contentMd: "chapter body",
    },
  ]);

  await db.insert(references_).values({
    libraryId,
    userId: u.id,
    folderPath: "classics/",
    citationKey: "vaswani2017attention",
    cslJson: {
      id: "vaswani2017attention",
      type: "article-journal",
      title: "Attention Is All You Need",
    },
  });

  const [paper] = await db
    .insert(papers)
    .values({
      libraryId,
      userId: u.id,
      folderPath: "biology/",
      filename: "crispr-paper.pdf",
      title: "CRISPR",
    })
    .returning({ id: papers.id });
  paperId = paper.id;
  await storage.uploadObject(
    paperSourceKey(paperId),
    PDF_BYTES,
    "application/pdf",
  );
}, 60_000);

afterAll(async () => {
  await storage.deleteObject(paperSourceKey(paperId)).catch(() => {});
  await deleteTestUser(u.id);
});

describe("exportLibraryZip", () => {
  it("section='all' includes notes, references, and papers at expected paths", async () => {
    const stream = exportLibraryZip({ libraryId, section: "all" });
    const buf = await streamToBuffer(stream);
    const entries = await zipEntries(buf);

    expect(entries.has("MyLibrary/notes/welcome.md")).toBe(true);
    expect(entries.has("MyLibrary/notes/inbox/quick-idea.md")).toBe(true);
    expect(entries.has("MyLibrary/notes/projects/phd/chapter-2.md")).toBe(true);
    expect(
      entries.has("MyLibrary/references/classics/vaswani2017attention.json"),
    ).toBe(true);
    expect(entries.has("MyLibrary/papers/biology/crispr-paper.pdf")).toBe(true);

    // Paper bytes round-trip.
    const paperBytes = entries.get("MyLibrary/papers/biology/crispr-paper.pdf")!;
    expect(paperBytes.equals(PDF_BYTES)).toBe(true);

    // Reference JSON round-trip.
    const refBytes = entries.get(
      "MyLibrary/references/classics/vaswani2017attention.json",
    )!;
    const parsed = JSON.parse(refBytes.toString("utf8"));
    expect(parsed.title).toBe("Attention Is All You Need");
  }, 30_000);

  it("notes content_md round-trips byte-for-byte after stripping frontmatter", async () => {
    const stream = exportLibraryZip({ libraryId, section: "notes" });
    const buf = await streamToBuffer(stream);
    const entries = await zipEntries(buf);

    const welcome = entries.get("MyLibrary/notes/welcome.md")!.toString("utf8");
    // Body begins after the closing `---\n\n` of the frontmatter block.
    const marker = "\n---\n\n";
    const idx = welcome.indexOf(marker);
    expect(idx).toBeGreaterThan(0);
    const body = welcome.slice(idx + marker.length);
    expect(body).toBe("# Welcome\n\nHello.");

    // Frontmatter line format sanity.
    expect(welcome.startsWith("---\n")).toBe(true);
    expect(welcome).toContain('title: "Welcome"');
    expect(welcome).toContain("slug: welcome");
    expect(welcome).toContain('folder_path: ""');
  });

  it("section='notes' excludes references and papers entries", async () => {
    const stream = exportLibraryZip({ libraryId, section: "notes" });
    const buf = await streamToBuffer(stream);
    const entries = await zipEntries(buf);

    for (const path of entries.keys()) {
      expect(path.startsWith("MyLibrary/notes/")).toBe(true);
    }
    expect(entries.size).toBe(3);
  });
});
