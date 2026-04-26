// Prevent Next.js from caching the RSC payload. The server component mints a
// Hocuspocus JWT (10-min TTL) at render time; caching would serve a stale,
// expired token to the client and break collab connections.
export const dynamic = "force-dynamic";

import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getRequiredUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { noteLinks, notes, user } from "@episteme/db/schema";
import { getDefaultLibrary } from "@/lib/default-library";
import { PathPill, type PathPillSegment } from "@/components/PathPill";
import { splitFolderPath } from "@/lib/tree";
import { BacklinksPanel } from "@/components/BacklinksPanel";
import { NotePageClient } from "./NotePageClient";
import { mintCollabToken } from "@/lib/collab-token";
import { COLLAB_ENABLED } from "@/lib/flags";

export default async function NotePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const userId = await getRequiredUserId();
  const { slug } = await params;
  const [note] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.slug, slug)));
  if (!note) notFound();

  const [me] = await db
    .select({
      username: user.username,
      name: user.name,
      email: user.email,
    })
    .from(user)
    .where(eq(user.id, userId));

  // Mint the Hocuspocus JWT server-side so NoteEditor can create the collab
  // provider synchronously on first render — no client-side round-trip needed.
  const initialCollabToken = COLLAB_ENABLED ? await mintCollabToken(userId) : null;

  const linkRows = await db
    .select({
      title: noteLinks.targetTitleRaw,
      targetKind: noteLinks.targetKind,
      targetId: noteLinks.targetId,
      targetSlug: notes.slug,
    })
    .from(noteLinks)
    .leftJoin(notes, eq(notes.id, noteLinks.targetId))
    .where(eq(noteLinks.sourceNoteId, note.id));
  // `note_links.target_title_raw` is stored STRIPPED of the `@` / `pdf:`
  // prefix (see `classify()` in packages/markdown). But the WikiLink node's
  // `title` attr round-trips WITH the prefix. Re-add the prefix here so the
  // hydration lookup key matches node.title (lowercased).
  const resolvedLinks: Record<
    string,
    {
      targetKind: "note" | "reference" | "paper";
      targetId: string | null;
      targetSlug: string | null;
    }
  > = Object.fromEntries(
    linkRows.map((r) => {
      const prefix =
        r.targetKind === "reference"
          ? "@"
          : r.targetKind === "paper"
            ? "pdf:"
            : "";
      return [
        `${prefix}${r.title}`.toLowerCase(),
        {
          targetKind: r.targetKind,
          targetId: r.targetId,
          targetSlug: r.targetKind === "note" ? r.targetSlug ?? null : null,
        },
      ];
    }),
  );

  const library = await getDefaultLibrary(userId);
  const folderSegs = splitFolderPath(note.folderPath ?? "");
  const pillSegments: PathPillSegment[] = library
    ? [
        { id: "root", label: library.name, href: "/" },
        ...folderSegs.map((name, i) => ({
          id: `folder-${i}`,
          label: name,
          href:
            "/drive/" +
            folderSegs
              .slice(0, i + 1)
              .map((x) => encodeURIComponent(x))
              .join("/"),
        })),
        { id: "title", label: note.title, href: null },
      ]
    : [];
  return (
    <div className="mx-auto max-w-3xl p-6">
      {library && <PathPill className="mb-4" segments={pillSegments} />}
      <NotePageClient
        id={note.id}
        title={note.title}
        initialMd={note.contentMd ?? ""}
        resolvedLinks={resolvedLinks}
        initialUsername={me?.username ?? null}
        initialIsPublic={note.isPublic}
        initialPublicSlug={note.publicSlug ?? null}
        noteSlug={slug}
        userName={me?.name ?? me?.email ?? "anonymous"}
        initialCollabToken={initialCollabToken}
      />
      <BacklinksPanel noteId={note.id} />
    </div>
  );
}
