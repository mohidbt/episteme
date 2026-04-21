import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@episteme/auth";
import { redirect } from "next/navigation";
import { listTagsWithCounts } from "@/lib/notes/tag-queries";

export default async function TagsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");

  const tags = await listTagsWithCounts(session.user.id);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold mb-4">Tags</h1>
      {tags.length === 0 ? (
        <p className="text-muted-foreground">No tags yet</p>
      ) : (
        <ul className="space-y-1">
          {tags.map(({ tag, count }) => (
            <li key={tag}>
              <Link
                href={`/tags/${tag}`}
                className="text-primary font-mono hover:underline"
              >
                #{tag}
              </Link>
              <span className="ml-2 text-sm text-muted-foreground">({count})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
