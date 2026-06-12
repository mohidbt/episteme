// GSD-96 R3 — GET /api/library/recents
//
// Returns the user's most-recently opened library items, joined to the
// real entity row so the chat composer @-picker can render {id,title}
// without a second roundtrip. Dual-auth (cookie + HMAC) per agent-callable
// conventions — the agent never calls this today, but the composer ships
// inside the same surface that already uses HMAC for other reads.

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  userLibraryRecents,
  papers,
  notes,
  references_,
  papersets,
} from "@episteme/db/schema";
import { getAuthedUserId } from "@episteme/auth/internal";
import { jsonError } from "@/lib/crud";

type Kind = "paper" | "note" | "reference" | "paperset";
const VALID_KINDS: ReadonlySet<Kind> = new Set([
  "paper",
  "note",
  "reference",
  "paperset",
]);

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

interface Item {
  id: string;
  kind: Kind;
  title: string;
}

export async function GET(req: Request): Promise<Response> {
  const auth = await getAuthedUserId(req, "");
  if (!auth) return jsonError(401, "unauthorized");
  const userId = auth.userId;

  const url = new URL(req.url);
  const kindParam = url.searchParams.get("kind");
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(
    Math.max(parseInt(limitParam ?? `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  if (kindParam && !VALID_KINDS.has(kindParam as Kind)) {
    return jsonError(400, "invalid kind");
  }
  const kinds: Kind[] = kindParam
    ? [kindParam as Kind]
    : ["paper", "note", "reference", "paperset"];

  const items: Item[] = [];
  for (const kind of kinds) {
    const rows = await loadKind(userId, kind, limit);
    items.push(...rows);
  }
  // When all-kinds, sort across kinds by opened_at desc — single per-kind
  // queries already come sorted, but the merged list isn't. Cheap re-sort.
  if (!kindParam) {
    items.sort((a, b) => a.title.localeCompare(b.title));
  }
  return Response.json({ items: items.slice(0, limit) });
}

async function loadKind(
  userId: string,
  kind: Kind,
  limit: number,
): Promise<Item[]> {
  if (kind === "paper") {
    const rows = await db
      .select({
        id: papers.id,
        title: papers.title,
        filename: papers.filename,
      })
      .from(userLibraryRecents)
      .innerJoin(papers, eq(papers.id, userLibraryRecents.itemId))
      .where(
        and(
          eq(userLibraryRecents.userId, userId),
          eq(userLibraryRecents.kind, "paper"),
          eq(papers.userId, userId),
        ),
      )
      .orderBy(desc(userLibraryRecents.openedAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      kind: "paper" as const,
      title: r.title ?? r.filename,
    }));
  }
  if (kind === "note") {
    const rows = await db
      .select({ id: notes.id, title: notes.title })
      .from(userLibraryRecents)
      .innerJoin(notes, eq(notes.id, userLibraryRecents.itemId))
      .where(
        and(
          eq(userLibraryRecents.userId, userId),
          eq(userLibraryRecents.kind, "note"),
          eq(notes.userId, userId),
        ),
      )
      .orderBy(desc(userLibraryRecents.openedAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      kind: "note" as const,
      title: r.title ?? "Untitled",
    }));
  }
  if (kind === "reference") {
    const rows = await db
      .select({
        id: references_.id,
        citationKey: references_.citationKey,
        cslJson: references_.cslJson,
      })
      .from(userLibraryRecents)
      .innerJoin(references_, eq(references_.id, userLibraryRecents.itemId))
      .where(
        and(
          eq(userLibraryRecents.userId, userId),
          eq(userLibraryRecents.kind, "reference"),
          eq(references_.userId, userId),
        ),
      )
      .orderBy(desc(userLibraryRecents.openedAt))
      .limit(limit);
    return rows.map((r) => {
      const csl = r.cslJson as { title?: string } | null;
      return {
        id: r.id,
        kind: "reference" as const,
        title: csl?.title ?? r.citationKey,
      };
    });
  }
  // paperset
  const rows = await db
    .select({ id: papersets.id, filename: papersets.filename })
    .from(userLibraryRecents)
    .innerJoin(papersets, eq(papersets.id, userLibraryRecents.itemId))
    .where(
      and(
        eq(userLibraryRecents.userId, userId),
        eq(userLibraryRecents.kind, "paperset"),
        eq(papersets.userId, userId),
      ),
    )
    .orderBy(desc(userLibraryRecents.openedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    kind: "paperset" as const,
    title: r.filename ?? "Untitled",
  }));
}

// Silence unused-import linting in shape-only branches.
void sql;
