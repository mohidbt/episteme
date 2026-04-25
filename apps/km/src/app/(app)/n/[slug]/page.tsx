import { headers } from "next/headers";
import { auth } from "@episteme/auth";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { noteLinks, notes, user } from "@episteme/db/schema";
import { getDefaultLibrary } from "@/lib/default-library";
import { PathPill, type PathPillSegment } from "@/components/PathPill";
import { splitFolderPath } from "@/lib/tree";
import { BacklinksPanel } from "@/components/BacklinksPanel";
import { NotePageClient } from "./NotePageClient";

export default async function NotePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");
  const { slug } = await params;
  const [note] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, session.user.id), eq(notes.slug, slug)));
  if (!note) notFound();

  const [me] = await db
    .select({ username: user.username })
    .from(user)
    .where(eq(user.id, session.user.id));

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

  const library = await getDefaultLibrary(session.user.id);
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
        userName={session.user.name ?? session.user.email ?? "anonymous"}
      />
      <BacklinksPanel noteId={note.id} />
    </div>
  );
}
