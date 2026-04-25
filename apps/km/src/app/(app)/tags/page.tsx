import Link from "next/link";
import { getRequiredUserId } from "@/lib/session";
import { listTagsWithCounts } from "@/lib/notes/tag-queries";

export default async function TagsPage() {
  const userId = await getRequiredUserId();

  const tags = await listTagsWithCounts(userId);

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
