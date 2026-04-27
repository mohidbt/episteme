import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionInfo } from "@/lib/auth";
import { createThread, listThreadsForUser } from "@/lib/threads";

export async function GET(req: Request) {
  const session = await getSessionInfo(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const threads = await listThreadsForUser(session.userId);
  return NextResponse.json({ threads });
}

const PostBody = z.object({
  threadId: z.string().min(1).max(200).optional(),
  skill: z.string().min(1).max(100).optional(),
  modelOverride: z.string().min(1).max(200).optional(),
  title: z.string().min(1).max(500).optional(),
});

export async function POST(req: Request) {
  const session = await getSessionInfo(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = PostBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const thread = await createThread({ userId: session.userId, ...parsed.data });
  return NextResponse.json({ thread }, { status: 201 });
}
