import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { folders, papers, notes, references_, assets, papersets } from "@episteme/db/schema";
import { isDescendantOf } from "./folders";

/**
 * `updatedAt` is widened to `Date | number | string` because pages serialize
 * Date → number across the RSC boundary before handing contents to the client
 * FileBrowser. The DB-reading `listFolderContents` always returns Date.
 */
export type SerializableDate = Date | number | string;

export interface FolderContents {
  folders: { id: string; name: string; isTrash: boolean; sortOrder: number; updatedAt: SerializableDate }[];
  papers:     { kind: "paper";     id: string; title: string | null; folderId: string | null; updatedAt: SerializableDate }[];
  references: { kind: "reference"; id: string; title: string;        folderId: string | null; citationKey: string; updatedAt: SerializableDate }[];
  notes:      { kind: "note";      id: string; title: string;        folderId: string | null; slug: string; updatedAt: SerializableDate }[];
  assets:     { kind: "asset";     id: string; filename: string;     folderId: string | null; mimeType: string; updatedAt: SerializableDate }[];
  papersets:  { kind: "paperset";  id: string; filename: string;     folderId: string | null; updatedAt: SerializableDate }[];
}

async function assertFolder(libraryId: number, userId: string, folderId: string | null) {
  if (folderId == null) return;
  const [row] = await db.select({ libraryId: folders.libraryId, userId: folders.userId })
    .from(folders).where(eq(folders.id, folderId)).limit(1);
  if (!row || row.libraryId !== libraryId || row.userId !== userId) {
    throw Object.assign(new Error("folder not found"), { status: 404 });
  }
}

/**
 * Lean fetch of every folder in a library scoped to the user. Returns only
 * the columns FileBrowser needs for its cycle-check drag guard.
 */
export async function listAllFolders(
  libraryId: number, userId: string,
): Promise<{ id: string; parentId: string | null; name: string; isTrash: boolean }[]> {
  return db.select({
    id: folders.id,
    parentId: folders.parentId,
    name: folders.name,
    isTrash: folders.isTrash,
  }).from(folders).where(and(
    eq(folders.libraryId, libraryId),
    eq(folders.userId, userId),
  ));
}

export async function listFolderContents(
  libraryId: number, userId: string, folderId: string | null,
): Promise<FolderContents> {
  await assertFolder(libraryId, userId, folderId);

  const parentCond = folderId == null
    ? isNull(folders.parentId)
    : eq(folders.parentId, folderId);

  const [foldersRows, papersRows, refsRows, notesRows, assetsRows, papersetsRows] = await Promise.all([
    db.select({
      id: folders.id, name: folders.name, isTrash: folders.isTrash,
      sortOrder: folders.sortOrder, updatedAt: folders.updatedAt,
    }).from(folders).where(and(
      eq(folders.libraryId, libraryId),
      eq(folders.userId, userId),
      parentCond,
    )),
    db.select({
      id: papers.id, title: papers.title, folderId: papers.folderId, updatedAt: papers.updatedAt,
    }).from(papers).where(and(
      eq(papers.libraryId, libraryId),
      eq(papers.userId, userId),
      folderId == null ? isNull(papers.folderId) : eq(papers.folderId, folderId),
    )),
    db.select({
      id: references_.id, cslJson: references_.cslJson, citationKey: references_.citationKey,
      folderId: references_.folderId, updatedAt: references_.updatedAt,
    }).from(references_).where(and(
      eq(references_.libraryId, libraryId),
      eq(references_.userId, userId),
      folderId == null ? isNull(references_.folderId) : eq(references_.folderId, folderId),
    )),
    db.select({
      id: notes.id, title: notes.title, slug: notes.slug,
      folderId: notes.folderId, updatedAt: notes.updatedAt,
    }).from(notes).where(and(
      eq(notes.libraryId, libraryId),
      eq(notes.userId, userId),
      folderId == null ? isNull(notes.folderId) : eq(notes.folderId, folderId),
    )),
    db.select({
      id: assets.id, filename: assets.filename, mimeType: assets.mimeType,
      folderId: assets.folderId, updatedAt: assets.updatedAt,
    }).from(assets).where(and(
      eq(assets.libraryId, libraryId),
      eq(assets.userId, userId),
      folderId == null ? isNull(assets.folderId) : eq(assets.folderId, folderId),
    )),
    db.select({
      id: papersets.id, filename: papersets.filename,
      folderId: papersets.folderId, updatedAt: papersets.updatedAt,
    }).from(papersets).where(and(
      eq(papersets.libraryId, libraryId),
      eq(papersets.userId, userId),
      folderId == null ? isNull(papersets.folderId) : eq(papersets.folderId, folderId),
    )),
  ]);

  return {
    // Hide the agent-managed `.episteme` tree from drive listings (+44).
    folders: foldersRows.filter((f) => f.name !== ".episteme"),
    papers: papersRows.map((p) => ({ kind: "paper", ...p })),
    references: refsRows.map((r) => ({
      kind: "reference" as const,
      id: r.id,
      title: (r.cslJson as { title?: string } | null)?.title ?? r.citationKey,
      folderId: r.folderId,
      citationKey: r.citationKey,
      updatedAt: r.updatedAt,
    })),
    notes: notesRows.map((n) => ({ kind: "note", ...n })),
    assets: assetsRows.map((a) => ({ kind: "asset" as const, ...a })),
    papersets: papersetsRows.map((p) => ({ kind: "paperset" as const, ...p })),
  };
}

export async function getTrashFolderId(libraryId: number, userId: string): Promise<string> {
  const [row] = await db.select({ id: folders.id })
    .from(folders)
    .where(and(
      eq(folders.libraryId, libraryId),
      eq(folders.userId, userId),
      eq(folders.isTrash, true),
    )).limit(1);
  if (!row) throw new Error("trash folder missing — backfill not run?");
  return row.id;
}

export async function createFolder(opts: {
  libraryId: number; userId: string; parentId: string | null; name: string;
}): Promise<{ id: string }> {
  await assertFolder(opts.libraryId, opts.userId, opts.parentId);
  const [row] = await db.insert(folders).values({
    libraryId: opts.libraryId,
    userId: opts.userId,
    parentId: opts.parentId,
    name: opts.name,
  }).returning({ id: folders.id });
  return { id: row.id };
}

/**
 * Returns the id of the folder matching (libraryId, parentId, name), creating
 * it if it doesn't exist yet. Safe to call concurrently — uses ON CONFLICT DO
 * NOTHING + a follow-up SELECT so duplicate calls return the same row.
 */
export async function getOrCreateFolder(opts: {
  libraryId: number; userId: string; parentId: string | null; name: string;
}): Promise<{ id: string }> {
  // Try insert; ignore unique-violation (library_id, parent_id, name).
  const parentCond = opts.parentId == null
    ? isNull(folders.parentId)
    : eq(folders.parentId, opts.parentId);

  await db.insert(folders).values({
    libraryId: opts.libraryId,
    userId: opts.userId,
    parentId: opts.parentId,
    name: opts.name,
  }).onConflictDoNothing();

  const [row] = await db.select({ id: folders.id })
    .from(folders)
    .where(and(
      eq(folders.libraryId, opts.libraryId),
      eq(folders.userId, opts.userId),
      parentCond,
      eq(folders.name, opts.name),
    ))
    .limit(1);

  if (!row) throw new Error(`getOrCreateFolder: unexpected missing row for ${opts.name}`);
  return { id: row.id };
}

export async function renameFolder(opts: {
  folderId: string; userId: string; newName: string;
}): Promise<void> {
  const [row] = await db.select({ isTrash: folders.isTrash })
    .from(folders)
    .where(and(eq(folders.id, opts.folderId), eq(folders.userId, opts.userId)))
    .limit(1);
  if (!row) throw Object.assign(new Error("not found"), { status: 404 });
  if (row.isTrash) throw Object.assign(new Error("cannot rename trash"), { status: 400 });
  await db.update(folders).set({ name: opts.newName }).where(eq(folders.id, opts.folderId));
}

export async function moveFolder(opts: {
  folderId: string; userId: string; targetParentId: string | null;
}): Promise<void> {
  const libraryFolders = await db.select({
    id: folders.id, parentId: folders.parentId, name: folders.name, isTrash: folders.isTrash,
  }).from(folders).where(eq(folders.userId, opts.userId));

  const subject = libraryFolders.find((f) => f.id === opts.folderId);
  if (!subject) throw Object.assign(new Error("not found"), { status: 404 });
  if (subject.isTrash) throw Object.assign(new Error("cannot move trash"), { status: 400 });
  if (opts.targetParentId && isDescendantOf(libraryFolders, opts.folderId, opts.targetParentId)) {
    throw Object.assign(new Error("cycle"), { status: 400 });
  }
  await db.update(folders).set({ parentId: opts.targetParentId }).where(eq(folders.id, opts.folderId));
}

type ItemKind = "paper" | "reference" | "note" | "paperset";
const tableFor = (k: ItemKind) =>
  k === "paper" ? papers
  : k === "note" ? notes
  : k === "paperset" ? papersets
  : references_;

export async function moveItemToFolder(opts: {
  kind: ItemKind; itemId: string; userId: string; targetFolderId: string | null;
}): Promise<void> {
  const t = tableFor(opts.kind);
  const [row] = await db.select({ id: t.id, libraryId: t.libraryId })
    .from(t).where(and(eq(t.id, opts.itemId), eq(t.userId, opts.userId))).limit(1);
  if (!row) throw Object.assign(new Error("not found"), { status: 404 });
  if (opts.targetFolderId) await assertFolder(row.libraryId, opts.userId, opts.targetFolderId);
  await db.update(t).set({ folderId: opts.targetFolderId }).where(eq(t.id, opts.itemId));
  // GSD-76: when a paper moves, its hidden ref-twin follows so library export
  // keeps them co-located. Identified by references_.paperId = paper.id.
  if (opts.kind === "paper") {
    await db.update(references_)
      .set({ folderId: opts.targetFolderId })
      .where(and(eq(references_.userId, opts.userId), eq(references_.paperId, opts.itemId)));
  }
}

export async function moveToTrash(opts: {
  libraryId: number; userId: string; target:
    | { kind: "folder"; id: string }
    | { kind: ItemKind;  id: string };
}): Promise<void> {
  const trashId = await getTrashFolderId(opts.libraryId, opts.userId);
  if (opts.target.kind === "folder") {
    const [f] = await db.select({ parentId: folders.parentId, isTrash: folders.isTrash })
      .from(folders).where(eq(folders.id, opts.target.id)).limit(1);
    if (!f) throw Object.assign(new Error("not found"), { status: 404 });
    if (f.isTrash) throw Object.assign(new Error("already trash"), { status: 400 });
    await db.update(folders)
      .set({ parentId: trashId })
      .where(eq(folders.id, opts.target.id));
    return;
  }
  const t = tableFor(opts.target.kind);
  const [row] = await db.select({ folderId: t.folderId })
    .from(t).where(and(eq(t.id, opts.target.id), eq(t.userId, opts.userId))).limit(1);
  if (!row) throw Object.assign(new Error("not found"), { status: 404 });
  await db.update(t).set({
    folderId: trashId,
    prevFolderId: row.folderId,
  }).where(eq(t.id, opts.target.id));
}

export async function restoreFromTrash(opts: {
  libraryId: number; userId: string; target:
    | { kind: "folder"; id: string }
    | { kind: ItemKind;  id: string };
}): Promise<void> {
  if (opts.target.kind === "folder") {
    await db.update(folders).set({ parentId: null }).where(eq(folders.id, opts.target.id));
    return;
  }
  const t = tableFor(opts.target.kind);
  const [row] = await db.select({ prevFolderId: t.prevFolderId })
    .from(t).where(and(eq(t.id, opts.target.id), eq(t.userId, opts.userId))).limit(1);
  if (!row) throw Object.assign(new Error("not found"), { status: 404 });
  await db.update(t).set({
    folderId: row.prevFolderId ?? null,
    prevFolderId: null,
  }).where(eq(t.id, opts.target.id));
}

export async function emptyTrash(opts: { libraryId: number; userId: string }): Promise<void> {
  const trashId = await getTrashFolderId(opts.libraryId, opts.userId);
  for (const t of [papers, notes, references_, papersets] as const) {
    await db.delete(t).where(and(
      eq(t.userId, opts.userId),
      eq(t.folderId, trashId),
    ));
  }
  await db.delete(folders).where(and(
    eq(folders.userId, opts.userId),
    eq(folders.parentId, trashId),
  ));
}
