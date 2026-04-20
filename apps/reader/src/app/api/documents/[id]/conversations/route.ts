import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { db } from "@episteme/db";
import { agentConversations, documents } from "@episteme/db/schema";
import { and, eq, desc } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const documentId = parseInt(id, 10);
  if (Number.isNaN(documentId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  const [doc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, session.user.id)))
    .limit(1);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await db
    .select({
      id: agentConversations.id,
      title: agentConversations.title,
      createdAt: agentConversations.createdAt,
      updatedAt: agentConversations.updatedAt,
    })
    .from(agentConversations)
    .where(
      and(
        eq(agentConversations.documentId, documentId),
        eq(agentConversations.userId, session.user.id)
      )
    )
    .orderBy(desc(agentConversations.updatedAt));

  return NextResponse.json({ conversations: rows });
}
