import { headers } from "next/headers";
import { auth } from "@episteme/auth";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { noteLinks, notes } from "@episteme/db/schema";
import { getDefaultLibrary } from "@/lib/default-library";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BacklinksPanel } from "@/components/BacklinksPanel";
import { NoteEditor } from "./NoteEditor";

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

  const linkRows = await db
    .select({
      title: noteLinks.targetTitleRaw,
      targetKind: noteLinks.targetKind,
      targetId: noteLinks.targetId,
    })
    .from(noteLinks)
    .where(eq(noteLinks.sourceNoteId, note.id));
  const resolvedLinks: Record<
    string,
    { targetKind: "note" | "reference" | "paper"; targetId: string | null }
  > = Object.fromEntries(
    linkRows.map((r) => [
      r.title.toLowerCase(),
      { targetKind: r.targetKind, targetId: r.targetId },
    ]),
  );

  const library = await getDefaultLibrary(session.user.id);
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
      <h1
        className="text-2xl font-semibold mb-3"
        data-testid="note-title"
      >
        {note.title}
      </h1>
      <NoteEditor
        id={note.id}
        initialMd={note.contentMd ?? ""}
        resolvedLinks={resolvedLinks}
      />
      <BacklinksPanel noteId={note.id} />
    </div>
  );
}
