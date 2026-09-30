// Prevent Next.js from caching the RSC payload. The server component mints a
// Hocuspocus JWT (10-min TTL) at render time; caching would serve a stale,
// expired token to the client and break collab connections.
export const dynamic = "force-dynamic";

import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { getRequiredUserId } from "@/lib/session";
import { touchRecent } from "@/lib/library/touch-recents";
import { db } from "@/lib/db";
import { notes, user } from "@episteme/db/schema";
import { getDefaultLibrary } from "@/lib/default-library";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { TabTitleUpdater } from "@/components/TabBar";
import { BacklinksPanel } from "@/components/BacklinksPanel";
import { NotePageClient } from "./NotePageClient";
import { mintCollabToken } from "@/lib/collab-token";
import { COLLAB_ENABLED } from "@/lib/flags";
import { prepareNoteContent } from "@/lib/note-content";
import { getResolvedLinks } from "@/lib/notes/resolved-links";

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

  // GSD-96 R3 — fire-and-forget recents touch (powers @-picker empty state).
  after(() =>
    touchRecent({ userId, kind: "note", itemId: note.id, swallow: true }),
  );

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

  const resolvedLinks = await getResolvedLinks(note.id);

  const library = await getDefaultLibrary(userId);
  return (
    <div className="mx-auto max-w-3xl p-6">
      <TabTitleUpdater href={`/n/${slug}`} title={note.title} />
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
        libraryId={note.libraryId}
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
