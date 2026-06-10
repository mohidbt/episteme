import { NextResponse } from "next/server";
import { z } from "zod";
import { createFolder } from "@/lib/folders-server";
import { validateFolderName, normalizeFolderName } from "@/lib/folders";
import { db } from "@/lib/db";
import { libraries, folders } from "@episteme/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { requireNonGuestAuthed } from "@/lib/auth/require-non-guest";
import { jsonError } from "@/lib/crud";

/**
 * GET /api/folders?libraryId=<int>
 * Returns folder rows for the given library owned by the authed user.
 * Dual-auth: session cookie OR internal HMAC (used by the agent tool
 * `list_folders` to discover where notes can be filed).
 *
 * If `libraryId` is omitted on an HMAC-authed request, the user's default
 * (lowest-id) library is used — mirrors the /api/notes GET pattern.
 */
export async function GET(req: Request) {
  let authed;
  try { authed = await getAuthedUserId(req); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return jsonError(500, "internal auth misconfigured");
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const url = new URL(req.url);
  const libraryIdStr = url.searchParams.get("libraryId");
  let libraryId: number;
  if (libraryIdStr) {
    libraryId = Number(libraryIdStr);
    if (!Number.isFinite(libraryId)) return jsonError(400, "validation");
  } else {
    // Default to the user's lowest-id library when libraryId is omitted.
    // Same fallback that the HMAC branch already used; extending it to the
    // cookie path so single-library callers (e.g. reader citation card
    // folder picker) don't have to plumb libraryId through.
    const [defaultLib] = await db
      .select({ id: libraries.id })
      .from(libraries)
      .where(eq(libraries.userId, userId))
      .orderBy(asc(libraries.id))
      .limit(1);
    if (!defaultLib) return jsonError(400, "no_library", { message: "user has no library" });
    libraryId = defaultLib.id;
  }
  // Verify ownership of the library.
  const [lib] = await db
    .select({ id: libraries.id })
    .from(libraries)
    .where(and(eq(libraries.id, libraryId), eq(libraries.userId, userId)))
    .limit(1);
  if (!lib) return jsonError(404, "not_found");
  const rows = await db
    .select({
      id: folders.id,
      name: folders.name,
      parentId: folders.parentId,
      isTrash: folders.isTrash,
      sortOrder: folders.sortOrder,
    })
    .from(folders)
    .where(and(eq(folders.libraryId, libraryId), eq(folders.userId, userId)))
    .orderBy(asc(folders.sortOrder), asc(folders.name));
  return Response.json({ libraryId, folders: rows });
}

const Body = z.object({
  libraryId: z.number().int().positive(),
  parentId: z.string().uuid().nullable(),
  name: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  const rawBody = await req.text();
  // K9: anonymous guests cannot create folders (UI-side gate already hides
  // the action; this is the server-side enforcement). HMAC callers
  // (agent tools) pass through.
  const gate = await requireNonGuestAuthed(req, rawBody);
  if (!gate.ok) return gate.response;
  const userId = gate.userId;

  let parsedJson: unknown = null;
  try { parsedJson = JSON.parse(rawBody); } catch { /* leaves null */ }
  const parsed = Body.safeParse(parsedJson);
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const { libraryId, parentId, name } = parsed.data;

  const normalized = normalizeFolderName(name);
  const nameErr = validateFolderName(normalized);
  if (nameErr) return NextResponse.json({ error: nameErr }, { status: 400 });

  const [lib] = await db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.id, libraryId), eq(libraries.userId, userId)))
    .limit(1);
  if (!lib) return NextResponse.json({ error: "library not found" }, { status: 404 });

  // GSD-87: pre-validate parent so a stale/foreign parentId returns a
  // structured 404 instead of bubbling through the generic 500 catch.
  if (parentId != null) {
    const [parent] = await db.select({ id: folders.id }).from(folders)
      .where(and(
        eq(folders.id, parentId),
        eq(folders.libraryId, libraryId),
        eq(folders.userId, userId),
      ))
      .limit(1);
    if (!parent) return NextResponse.json({ error: "parent not found" }, { status: 404 });
  }

  // app-level duplicate check: postgres unique index treats NULLs as distinct,
  // so root-level siblings (parentId = NULL) aren't caught by the index alone.
  const parentCond = parentId == null ? isNull(folders.parentId) : eq(folders.parentId, parentId);
  const [dup] = await db.select({ id: folders.id }).from(folders)
    .where(and(
      eq(folders.libraryId, libraryId),
      eq(folders.userId, userId),
      parentCond,
      eq(folders.name, normalized),
    )).limit(1);
  if (dup) return NextResponse.json({ error: "duplicate name" }, { status: 409 });

  try {
    const out = await createFolder({
      libraryId, userId, parentId, name: normalized,
    });
    return NextResponse.json(out, { status: 201 });
  } catch (e: unknown) {
    const err = e as { code?: string; status?: number; message?: string };
    if (err.code === "23505") return NextResponse.json({ error: "duplicate name" }, { status: 409 });
    // GSD-87: surface explicit 4xx statuses (e.g. assertFolder 404) instead
    // of collapsing them to 500. Keeps the agent error path structured.
    if (typeof err.status === "number" && err.status >= 400 && err.status < 500) {
      return NextResponse.json({ error: err.message ?? "bad request" }, { status: err.status });
    }
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
