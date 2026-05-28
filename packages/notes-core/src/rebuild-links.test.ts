// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@episteme/db";
import {
  libraries,
  noteLinks,
  noteTags,
  notes,
  papers,
  references_,
} from "@episteme/db/schema";
import {
  createTestUser,
  deleteTestUser,
  type TestUser,
} from "./_test-utils";
import { rebuildLinks, resolveUnresolvedNoteLinks } from "./rebuild-links";

let u: TestUser;
let libraryId: number;
let sourceNoteId: string;
let targetNoteId: string;
let referenceId: string;
let paperId: string;

async function insertNote(opts: {
  userId: string;
  libraryId: number;
  title: string;
  slug: string;
  contentMd?: string;
}): Promise<string> {
  const [row] = await db
    .insert(notes)
    .values({
      userId: opts.userId,
      libraryId: opts.libraryId,
      title: opts.title,
      slug: opts.slug,
      contentMd: opts.contentMd ?? "",
    })
    .returning({ id: notes.id });
  return row.id;
}

beforeAll(async () => {
  u = await createTestUser();

  const [lib] = await db
    .insert(libraries)
    .values({ userId: u.id, name: "Rebuild Lib" })
    .returning();
  libraryId = lib.id;

  targetNoteId = await insertNote({
    userId: u.id,
    libraryId,
    title: "Transformers",
    slug: `transformers-${Date.now()}`,
  });

  sourceNoteId = await insertNote({
    userId: u.id,
    libraryId,
    title: "Source",
    slug: `source-${Date.now()}`,
  });

  const [ref] = await db
    .insert(references_)
    .values({
      userId: u.id,
      libraryId,
      citationKey: "vaswani2017",
    })
    .returning({ id: references_.id });
  referenceId = ref.id;

  const [paper] = await db
    .insert(papers)
    .values({
      userId: u.id,
      libraryId,
      filename: "crispr.pdf",
    })
    .returning({ id: papers.id });
  paperId = paper.id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
});

afterEach(async () => {
  // Each test rebuilds from scratch; wipe between tests to avoid cross-talk.
  await db.delete(noteLinks).where(eq(noteLinks.sourceNoteId, sourceNoteId));
  await db.delete(noteTags).where(eq(noteTags.noteId, sourceNoteId));
});

async function linksOf(noteId: string) {
  return db
    .select({
      targetKind: noteLinks.targetKind,
      targetId: noteLinks.targetId,
      targetTitleRaw: noteLinks.targetTitleRaw,
    })
    .from(noteLinks)
    .where(eq(noteLinks.sourceNoteId, noteId))
    .orderBy(asc(noteLinks.targetTitleRaw));
}

async function tagsOf(noteId: string) {
  return db
    .select({ tag: noteTags.tag })
    .from(noteTags)
    .where(eq(noteTags.noteId, noteId))
    .orderBy(asc(noteTags.tag));
}

describe("rebuildLinks — resolution", () => {
  it("resolves note, reference, and paper links to correct targets", async () => {
    await rebuildLinks(
      sourceNoteId,
      "see [[Transformers]] and [[@vaswani2017]] and [[pdf:crispr.pdf]]",
      u.id,
    );
    const rows = await linksOf(sourceNoteId);
    expect(rows).toHaveLength(3);
    const byKind = Object.fromEntries(rows.map((r) => [r.targetKind, r]));
    expect(byKind.note.targetId).toBe(targetNoteId);
    expect(byKind.note.targetTitleRaw).toBe("Transformers");
    expect(byKind.reference.targetId).toBe(referenceId);
    expect(byKind.reference.targetTitleRaw).toBe("vaswani2017");
    expect(byKind.paper.targetId).toBe(paperId);
    expect(byKind.paper.targetTitleRaw).toBe("crispr.pdf");
  });

  it("stores null targetId and raw identifier for unresolved links", async () => {
    await rebuildLinks(
      sourceNoteId,
      "[[Unknown Note]] and [[@missingkey]] and [[pdf:notfound.pdf]]",
      u.id,
    );
    const rows = await linksOf(sourceNoteId);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.targetId).toBeNull();
    const raws = rows.map((r) => r.targetTitleRaw).sort();
    expect(raws).toEqual(["Unknown Note", "missingkey", "notfound.pdf"].sort());
  });

  it("stores raw (not alias) in targetTitleRaw for aliased links", async () => {
    await rebuildLinks(sourceNoteId, "[[Transformers|TF shortcut]]", u.id);
    const rows = await linksOf(sourceNoteId);
    expect(rows).toHaveLength(1);
    expect(rows[0].targetTitleRaw).toBe("Transformers");
    expect(rows[0].targetId).toBe(targetNoteId);
  });

  it("resolves note links case-insensitively", async () => {
    await rebuildLinks(sourceNoteId, "[[transformers]] and [[TRANSFORMERS]]", u.id);
    const rows = await linksOf(sourceNoteId);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.targetId).toBe(targetNoteId);
  });

  it("does not self-resolve a note-link to the source note", async () => {
    await rebuildLinks(sourceNoteId, "[[source]]", u.id);
    const rows = await linksOf(sourceNoteId);
    expect(rows).toHaveLength(1);
    expect(rows[0].targetId).toBeNull();
    expect(rows[0].targetTitleRaw).toBe("source");
  });

  it("scopes resolution to the source note's user", async () => {
    const v = await createTestUser();
    try {
      const [vLib] = await db
        .insert(libraries)
        .values({ userId: v.id, name: "V Lib" })
        .returning();
      await insertNote({
        userId: v.id,
        libraryId: vLib.id,
        title: "Transformers",
        slug: `transformers-v-${Date.now()}`,
      });

      await rebuildLinks(sourceNoteId, "[[Transformers]]", u.id);
      const rows = await linksOf(sourceNoteId);
      expect(rows).toHaveLength(1);
      expect(rows[0].targetId).toBe(targetNoteId);
    } finally {
      await deleteTestUser(v.id);
    }
  });

  it("resolves [[r:Title]] against references_.cslJson.title (case-insensitive)", async () => {
    // The WikiLink typeahead inserts `r:<reference.title>` — not the citation
    // key. Verify rebuildLinks resolves the title form so pills don't go red.
    const [titled] = await db
      .insert(references_)
      .values({
        userId: u.id,
        libraryId,
        citationKey: "brown2020language",
        cslJson: { title: "Language Models are Few-Shot Learners" },
      })
      .returning({ id: references_.id });
    try {
      await rebuildLinks(
        sourceNoteId,
        "[[r:Language Models are Few-Shot Learners]]",
        u.id,
      );
      const rows = await linksOf(sourceNoteId);
      const ref = rows.find((r) => r.targetKind === "reference");
      expect(ref?.targetId).toBe(titled.id);
    } finally {
      await db.delete(references_).where(eq(references_.id, titled.id));
    }
  });

  it("still resolves [[r:citationKey]] (regression: citation-key path)", async () => {
    const [titled] = await db
      .insert(references_)
      .values({
        userId: u.id,
        libraryId,
        citationKey: "brown2020language",
        cslJson: { title: "Language Models are Few-Shot Learners" },
      })
      .returning({ id: references_.id });
    try {
      await rebuildLinks(sourceNoteId, "[[r:brown2020language]]", u.id);
      const rows = await linksOf(sourceNoteId);
      const ref = rows.find((r) => r.targetKind === "reference");
      expect(ref?.targetId).toBe(titled.id);
    } finally {
      await db.delete(references_).where(eq(references_.id, titled.id));
    }
  });

  it("resolves reference title case-insensitively", async () => {
    const [titled] = await db
      .insert(references_)
      .values({
        userId: u.id,
        libraryId,
        citationKey: "brown2020language",
        cslJson: { title: "Language Models are Few-Shot Learners" },
      })
      .returning({ id: references_.id });
    try {
      await rebuildLinks(
        sourceNoteId,
        "[[r:LANGUAGE MODELS ARE FEW-SHOT LEARNERS]]",
        u.id,
      );
      const rows = await linksOf(sourceNoteId);
      const ref = rows.find((r) => r.targetKind === "reference");
      expect(ref?.targetId).toBe(titled.id);
    } finally {
      await db.delete(references_).where(eq(references_.id, titled.id));
    }
  });

  it("resolves [[pdf:Title]] against papers.title (case-insensitive)", async () => {
    // The WikiLink typeahead inserts `pdf:<paper.title>` — not the filename.
    // Verify rebuildLinks resolves the title form so pills don't go red on
    // refresh.
    const [titled] = await db
      .insert(papers)
      .values({
        userId: u.id,
        libraryId,
        filename: "attn.pdf",
        title: "Attention Is All You Need",
      })
      .returning({ id: papers.id });
    try {
      await rebuildLinks(
        sourceNoteId,
        "[[pdf:attention is all you need]]",
        u.id,
      );
      const rows = await linksOf(sourceNoteId);
      const paper = rows.find((r) => r.targetKind === "paper");
      expect(paper?.targetId).toBe(titled.id);
    } finally {
      await db.delete(papers).where(eq(papers.id, titled.id));
    }
  });

  it("filename match wins over title match on collision", async () => {
    // Codex regression guard: paper A's title equals paper B's filename.
    // A `[[pdf:<that-string>]]` link must resolve to paper B (exact
    // filename), not paper A (case-insensitive title).
    const collision = "collide.pdf";
    const [paperA] = await db
      .insert(papers)
      .values({
        userId: u.id,
        libraryId,
        filename: "actual-a.pdf",
        title: collision, // paper A's title is the literal "collide.pdf"
      })
      .returning({ id: papers.id });
    const [paperB] = await db
      .insert(papers)
      .values({
        userId: u.id,
        libraryId,
        filename: collision, // paper B's filename matches
        title: "Some Other Paper",
      })
      .returning({ id: papers.id });
    try {
      await rebuildLinks(sourceNoteId, `[[pdf:${collision}]]`, u.id);
      const rows = await linksOf(sourceNoteId);
      const paper = rows.find((r) => r.targetKind === "paper");
      expect(paper?.targetId).toBe(paperB.id); // filename match wins
    } finally {
      await db.delete(papers).where(eq(papers.id, paperA.id));
      await db.delete(papers).where(eq(papers.id, paperB.id));
    }
  });

  it("still resolves [[pdf:filename.pdf]] when title is null", async () => {
    // Legacy / fallback: paper without a title must still resolve when the
    // note links by its filename.
    const [untitled] = await db
      .insert(papers)
      .values({ userId: u.id, libraryId, filename: "legacy-only.pdf" })
      .returning({ id: papers.id });
    try {
      await rebuildLinks(sourceNoteId, "[[pdf:legacy-only.pdf]]", u.id);
      const rows = await linksOf(sourceNoteId);
      const paper = rows.find((r) => r.targetKind === "paper");
      expect(paper?.targetId).toBe(untitled.id);
    } finally {
      await db.delete(papers).where(eq(papers.id, untitled.id));
    }
  });

  it("picks the most recently added paper on filename collision", async () => {
    // Insert an older and newer paper sharing a filename; newer wins.
    const olderAddedAt = new Date(Date.now() - 60_000);
    const [older] = await db
      .insert(papers)
      .values({
        userId: u.id,
        libraryId,
        filename: "dup.pdf",
        addedAt: olderAddedAt,
      })
      .returning({ id: papers.id });
    const [newer] = await db
      .insert(papers)
      .values({ userId: u.id, libraryId, filename: "dup.pdf" })
      .returning({ id: papers.id });

    try {
      await rebuildLinks(sourceNoteId, "[[pdf:dup.pdf]]", u.id);
      const rows = await linksOf(sourceNoteId);
      expect(rows).toHaveLength(1);
      expect(rows[0].targetId).toBe(newer.id);
    } finally {
      await db.delete(papers).where(eq(papers.id, older.id));
      await db.delete(papers).where(eq(papers.id, newer.id));
    }
  });
});

describe("rebuildLinks — idempotency & replacement", () => {
  it("replaces existing links on rebuild", async () => {
    await rebuildLinks(
      sourceNoteId,
      "[[Transformers]] and [[@vaswani2017]] and [[pdf:crispr.pdf]]",
      u.id,
    );
    expect((await linksOf(sourceNoteId)).length).toBe(3);

    await rebuildLinks(sourceNoteId, "[[Transformers]]", u.id);
    const rows = await linksOf(sourceNoteId);
    expect(rows).toHaveLength(1);
    expect(rows[0].targetKind).toBe("note");
  });

  it("replaces existing tags on rebuild", async () => {
    await rebuildLinks(sourceNoteId, "body #ml and #deep", u.id);
    expect((await tagsOf(sourceNoteId)).map((r) => r.tag).sort()).toEqual([
      "deep",
      "ml",
    ]);

    await rebuildLinks(sourceNoteId, "body #ml only", u.id);
    expect((await tagsOf(sourceNoteId)).map((r) => r.tag)).toEqual(["ml"]);
  });

  it("does not trip the (note_id, tag) unique constraint on duplicate tags", async () => {
    await rebuildLinks(sourceNoteId, "#ml and #ML again", u.id);
    const rows = await tagsOf(sourceNoteId);
    expect(rows).toHaveLength(1);
    expect(rows[0].tag).toBe("ml");
  });
});

describe("rebuildLinks — tags", () => {
  it("inserts one row per unique tag", async () => {
    await rebuildLinks(sourceNoteId, "body with #ml and #deep-learning", u.id);
    const rows = await tagsOf(sourceNoteId);
    expect(rows.map((r) => r.tag).sort()).toEqual(["deep-learning", "ml"]);
  });

  it("wipes previous tags when md has none", async () => {
    await rebuildLinks(sourceNoteId, "#seeded", u.id);
    expect((await tagsOf(sourceNoteId)).length).toBe(1);
    await rebuildLinks(sourceNoteId, "plain body, no tags", u.id);
    expect((await tagsOf(sourceNoteId)).length).toBe(0);
  });

  it("is a no-op on empty markdown", async () => {
    await rebuildLinks(sourceNoteId, "", u.id);
    expect((await linksOf(sourceNoteId)).length).toBe(0);
    expect((await tagsOf(sourceNoteId)).length).toBe(0);
  });
});

describe("resolveUnresolvedNoteLinks", () => {
  it("back-fills note-kind unresolved links matching the new title", async () => {
    // Seed: sourceNote links to "Ghost" (doesn't exist yet).
    await rebuildLinks(sourceNoteId, "see [[Ghost]]", u.id);
    const before = await linksOf(sourceNoteId);
    expect(before).toHaveLength(1);
    expect(before[0].targetId).toBeNull();

    // Create the "Ghost" note and run the retro-resolver.
    const ghostId = await insertNote({
      userId: u.id,
      libraryId,
      title: "Ghost",
      slug: `ghost-${Date.now()}`,
    });
    try {
      await resolveUnresolvedNoteLinks(ghostId, "Ghost", u.id);
      const after = await linksOf(sourceNoteId);
      expect(after).toHaveLength(1);
      expect(after[0].targetId).toBe(ghostId);
    } finally {
      await db.delete(notes).where(eq(notes.id, ghostId));
    }
  });

  it("does not touch links belonging to other users", async () => {
    const v = await createTestUser();
    try {
      const [vLib] = await db
        .insert(libraries)
        .values({ userId: v.id, name: "V Lib" })
        .returning();
      const vSource = await insertNote({
        userId: v.id,
        libraryId: vLib.id,
        title: "VSource",
        slug: `vsource-${Date.now()}`,
      });
      // V's source references "SharedGhost" unresolved.
      await rebuildLinks(vSource, "[[SharedGhost]]", v.id);

      // U creates a "SharedGhost" note; V's link must NOT be back-filled.
      const uGhostId = await insertNote({
        userId: u.id,
        libraryId,
        title: "SharedGhost",
        slug: `sharedghost-${Date.now()}`,
      });
      try {
        await resolveUnresolvedNoteLinks(uGhostId, "SharedGhost", u.id);
        const [row] = await db
          .select({ targetId: noteLinks.targetId })
          .from(noteLinks)
          .where(eq(noteLinks.sourceNoteId, vSource));
        expect(row.targetId).toBeNull();
      } finally {
        await db.delete(notes).where(eq(notes.id, uGhostId));
      }
    } finally {
      await deleteTestUser(v.id);
    }
  });
});

// saveNoteMd integration test lives in apps/km where saveNoteMd is defined.
