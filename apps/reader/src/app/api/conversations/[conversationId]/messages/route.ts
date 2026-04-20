import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { db } from "@episteme/db";
import { agentConversations, agentMessages } from "@episteme/db/schema";
import { and, eq, asc } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { conversationId } = await params;
  const convId = parseInt(conversationId, 10);
  if (Number.isNaN(convId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  const [conv] = await db
    .select({ id: agentConversations.id })
    .from(agentConversations)
    .where(
      and(
        eq(agentConversations.id, convId),
        eq(agentConversations.userId, session.user.id)
      )
    )
    .limit(1);
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const messages = await db
    .select({
      id: agentMessages.id,
      role: agentMessages.role,
      content: agentMessages.content,
      createdAt: agentMessages.createdAt,
    })
    .from(agentMessages)
    .where(eq(agentMessages.conversationId, convId))
    .orderBy(asc(agentMessages.createdAt));

  return NextResponse.json({ messages });
}
