import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@episteme/auth";
import { redirect } from "next/navigation";
import { listNotesByTag } from "@/lib/notes/tag-queries";

export default async function TagPage({
  params,
}: {
  params: Promise<{ tag: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");

  const { tag } = await params;
  const normalizedTag = tag.toLowerCase();
  const notesList = await listNotesByTag(session.user.id, normalizedTag);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold mb-4 font-mono">#{normalizedTag}</h1>
      {notesList.length === 0 ? (
        <p className="text-muted-foreground">No notes with tag #{normalizedTag}</p>
      ) : (
        <ul className="space-y-1">
          {notesList.map(({ id, title, slug }) => (
            <li key={id}>
              <Link
                href={`/n/${slug}`}
                className="hover:underline"
              >
                {title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
