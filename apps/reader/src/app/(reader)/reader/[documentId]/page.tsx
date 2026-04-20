import { auth } from "@episteme/auth/server";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { after } from "next/server";
import { db } from "@episteme/db";
import { documents } from "@episteme/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { ReaderClient } from "./reader-client";

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");

  const { documentId } = await params;
  const id = parseInt(documentId, 10);
  if (isNaN(id)) notFound();
  const [doc] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, id),
        eq(documents.userId, session.user.id)
      )
    )
    .limit(1);

  if (!doc) notFound();

  after(async () => {
    await db
      .update(documents)
      .set({ lastOpenedAt: sql`now()` })
      .where(and(eq(documents.id, doc.id), eq(documents.userId, session.user.id)))
      .catch((err) => console.error("[reader] last_opened_at stamp failed", err));
  });

  return (
    <ReaderClient
      documentId={doc.id}
      title={doc.title}
      processingStatus={doc.processingStatus}
    />
  );
}
