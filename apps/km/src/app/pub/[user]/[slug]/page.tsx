import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Metadata } from "next";
import { getPublicNote } from "./_loader";

export const revalidate = 60;

function firstParagraph(md: string, max = 200): string {
  const first = md.split(/\n{2,}/).find((p) => p.trim().length > 0) ?? "";
  const clean = first.replace(/[#*_`~>]/g, "").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ user: string; slug: string }>;
}): Promise<Metadata> {
  const { user, slug } = await params;
  const row = await getPublicNote(user, slug);
  if (!row) return { title: "Not found" };
  return {
    title: row.title,
    openGraph: {
      title: row.title,
      description: firstParagraph(row.contentMd, 200),
    },
  };
}

export default async function PubNote({
  params,
}: {
  params: Promise<{ user: string; slug: string }>;
}) {
  const { user, slug } = await params;
  const row = await getPublicNote(user, slug);
  if (!row) notFound();
  return (
    <article className="epistaime-reader mx-auto max-w-[65ch] px-6 py-16 font-[var(--font-prose-serif)]">
      <header className="mb-10">
        <h1 className="text-4xl font-medium tracking-tight">{row.title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          by <span className="font-medium">@{row.username}</span>
          <span aria-hidden className="mx-2">
            ·
          </span>
          <time dateTime={new Date(row.updatedAt).toISOString()}>
            {new Date(row.updatedAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </time>
          <span aria-hidden className="mx-2">
            ·
          </span>
          <Link
            className="underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground"
            href={`/pub/${user}/${slug}/source`}
          >
            view source
          </Link>
        </p>
      </header>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{row.contentMd}</ReactMarkdown>
    </article>
  );
}
