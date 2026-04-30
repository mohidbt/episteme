import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentThreads } from "@episteme/db/schema";

export type AgentThreadStatus = "idle" | "running" | "awaiting_hitl" | "error";

export interface AgentThreadRow {
  userId: string;
  threadId: string;
  modelOverride: string | null;
  title: string | null;
  skill: string | null;
  status: AgentThreadStatus;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateThreadInput {
  userId: string;
  threadId?: string;
  skill?: string | null;
  modelOverride?: string | null;
  title?: string | null;
}

export interface UpdateThreadInput {
  title?: string | null;
  modelOverride?: string | null;
  status?: AgentThreadStatus;
  skill?: string | null;
  lastMessageAt?: Date;
}

export async function listThreadsForUser(userId: string): Promise<AgentThreadRow[]> {
  return db
    .select()
    .from(agentThreads)
    .where(eq(agentThreads.userId, userId))
    .orderBy(
      sql`${agentThreads.lastMessageAt} DESC NULLS LAST`,
      desc(agentThreads.createdAt),
    );
}

export async function getThread(
  userId: string,
  threadId: string,
): Promise<AgentThreadRow | null> {
  const [row] = await db
    .select()
    .from(agentThreads)
    .where(and(eq(agentThreads.userId, userId), eq(agentThreads.threadId, threadId)))
    .limit(1);
  return row ?? null;
}

export async function createThread(input: CreateThreadInput): Promise<AgentThreadRow> {
  const threadId = input.threadId ?? crypto.randomUUID();
  const [row] = await db
    .insert(agentThreads)
    .values({
      userId: input.userId,
      threadId,
      skill: input.skill ?? null,
      modelOverride: input.modelOverride ?? null,
      title: input.title ?? null,
    })
    .returning();
  return row;
}

export interface UpsertThreadOnInvokeInput {
  userId: string;
  threadId: string;
  skill?: string | null;
  modelOverride?: string | null;
  /**
   * Task #41 — when this is the first message on a brand-new thread, derive
   * a human-readable title from it so the /agents list doesn't fall back to
   * "Conversation #abcd1234". Only set on INSERT; existing rows keep their
   * title untouched.
   */
  initialTitle?: string | null;
}

/**
 * Single-roundtrip UPSERT for the invoke lifecycle.
 *
 * - INSERT (new row): set status=running, lastMessageAt=now, skill, modelOverride,
 *   and `title = initialTitle` when supplied.
 * - ON CONFLICT (user_id, thread_id): only bump status=running, lastMessageAt=now,
 *   updatedAt=now. Preserve title/skill/modelOverride/createdAt on existing rows.
 */
export async function upsertThreadOnInvoke(
  input: UpsertThreadOnInvokeInput,
): Promise<AgentThreadRow> {
  const now = new Date();
  const [row] = await db
    .insert(agentThreads)
    .values({
      userId: input.userId,
      threadId: input.threadId,
      skill: input.skill ?? null,
      modelOverride: input.modelOverride ?? null,
      title: input.initialTitle ?? null,
      status: "running",
      lastMessageAt: now,
    })
    .onConflictDoUpdate({
      target: [agentThreads.userId, agentThreads.threadId],
      set: {
        status: "running",
        lastMessageAt: now,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

export async function updateThread(
  userId: string,
  threadId: string,
  patch: UpdateThreadInput,
): Promise<AgentThreadRow | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.modelOverride !== undefined) set.modelOverride = patch.modelOverride;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.skill !== undefined) set.skill = patch.skill;
  if (patch.lastMessageAt !== undefined) set.lastMessageAt = patch.lastMessageAt;

  const [row] = await db
    .update(agentThreads)
    .set(set)
    .where(and(eq(agentThreads.userId, userId), eq(agentThreads.threadId, threadId)))
    .returning();
  return row ?? null;
}

export async function deleteThread(userId: string, threadId: string): Promise<boolean> {
  const rows = await db
    .delete(agentThreads)
    .where(and(eq(agentThreads.userId, userId), eq(agentThreads.threadId, threadId)))
    .returning({ threadId: agentThreads.threadId });
  return rows.length > 0;
}
