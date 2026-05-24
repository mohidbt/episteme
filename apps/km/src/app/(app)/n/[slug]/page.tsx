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
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BacklinksPanel } from "@/components/BacklinksPanel";
import { NotePageClient } from "./NotePageClient";
import { mintCollabToken } from "@/lib/collab-token";
import { COLLAB_ENABLED } from "@/lib/flags";
import { prepareNoteContent } from "@/lib/note-content";

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
  // K6: WikiLink node `title` attr stores the STRIPPED label (no `p:` / `r:`
  // / `@` / `pdf:` prefix). `note_links.target_title_raw` is also stored
  // STRIPPED. Key the resolvedLinks map by `${kind}::${title.toLowerCase()}`
  // so a paper "Foo" and a note "Foo" don't collide. Hydration in
  // `hydrate-wiki-links.ts` reads `node.attrs.targetKind` and looks up the
  // kind-qualified key, falling back to bare title for back-compat with
  // pre-classifier nodes (targetKind=null).
  const resolvedLinks: Record<
    string,
    {
      targetKind: "note" | "reference" | "paper";
      targetId: string | null;
      targetSlug: string | null;
    }
  > = Object.fromEntries(
    linkRows.map((r) => [
      `${r.targetKind}::${r.title.toLowerCase()}`,
      {
        targetKind: r.targetKind,
        targetId: r.targetId,
        targetSlug: r.targetKind === "note" ? r.targetSlug ?? null : null,
      },
    ]),
  );

  const library = await getDefaultLibrary(userId);
  return (
    <div className="mx-auto max-w-3xl p-6">
      {library && (
        <Breadcrumbs
          libraryName={library.name}
          section="notes"
          folderPath={note.folderPath ?? ""}
          title={note.title}
        />
      )}
      <NotePageClient
        id={note.id}
        title={note.title}
        initialMd={prepareNoteContent(note.contentMd ?? "")}
        resolvedLinks={resolvedLinks}
        initialUsername={me?.username ?? null}
        initialIsPublic={note.isPublic}
        initialPublicSlug={note.publicSlug ?? null}
        noteSlug={slug}
        userName={me?.name ?? me?.email ?? "anonymous"}
        initialCollabToken={initialCollabToken}
        updatedAt={note.updatedAt.toISOString()}
        referenceCount={Object.keys(resolvedLinks).length}
      />
      <BacklinksPanel noteId={note.id} />
    </div>
  );
}
