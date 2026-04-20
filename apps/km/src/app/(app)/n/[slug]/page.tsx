import { headers } from "next/headers";
import { auth } from "@episteme/auth";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";
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
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1
        className="text-2xl font-semibold mb-3"
        data-testid="note-title"
      >
        {note.title}
      </h1>
      <NoteEditor id={note.id} initialMd={note.contentMd ?? ""} />
    </div>
  );
}
