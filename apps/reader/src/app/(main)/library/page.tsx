import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@episteme/auth/server";
import { db } from "@episteme/db";
import { documents } from "@episteme/db/schema";
import { and, eq, desc, asc, or, ilike, sql } from "drizzle-orm";
import { UploadZone } from "@/components/library/upload-zone";
import { DocumentCard } from "@/components/library/document-card";
import { LibraryToolbar } from "@/components/library/library-toolbar";

type SortKey = "recent" | "uploaded" | "title";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; q?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");

  const sp = await searchParams;
  const sort: SortKey =
    sp.sort === "uploaded" || sp.sort === "title" ? sp.sort : "recent";
  const q = (sp.q ?? "").trim();

  const filters = [eq(documents.userId, session.user.id)];
  if (q.length > 0) {
    const needle = `%${q}%`;
    filters.push(or(ilike(documents.title, needle), ilike(documents.filename, needle))!);
  }

  const orderBy =
    sort === "title"
      ? [asc(documents.title)]
      : sort === "uploaded"
        ? [desc(documents.createdAt)]
        : [sql`${documents.lastOpenedAt} DESC NULLS LAST`, desc(documents.createdAt)];

  const docs = await db
    .select()
    .from(documents)
    .where(and(...filters))
    .orderBy(...orderBy);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-semibold mb-6">Library</h1>

      <UploadZone />

      <Suspense fallback={null}>
        <LibraryToolbar sort={sort} q={q} />
      </Suspense>

      {docs.length === 0 ? (
        <div className="mt-12 text-center text-muted-foreground">
          <p className="text-lg">{q ? "No matches." : "No documents yet."}</p>
          {!q && <p className="text-sm mt-1">Upload a PDF above to get started.</p>}
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {docs.map((doc) => (
            <DocumentCard
              key={doc.id}
              id={doc.id}
              title={doc.title}
              filename={doc.filename}
              pageCount={doc.pageCount}
              createdAt={doc.createdAt.toISOString()}
            />
          ))}
        </div>
      )}
    </div>
  );
}
