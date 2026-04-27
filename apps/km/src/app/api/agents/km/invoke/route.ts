import { z } from "zod";
import { getDecryptedApiKey } from "@episteme/auth/byok";
import { getSessionInfo } from "@/lib/auth";
import { signRequest } from "@/lib/agents/sign-request";
import { tapAgentEvents } from "@/lib/agents/thread-lifecycle";
import {
  createThread,
  getThread,
  updateThread,
  type AgentThreadStatus,
} from "@/lib/threads";

const InvokeBody = z.object({
  thread_id: z.string().min(1),
  message: z.string().optional(),
  skill: z.string().nullable().optional(),
  model_override: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const session = await getSessionInfo(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  let llmKey: string;
  try {
    llmKey = await getDecryptedApiKey(session.userId);
  } catch {
    return Response.json({ error: "no_api_key" }, { status: 400 });
  }

  const bodyText = await req.text();
  let body: z.infer<typeof InvokeBody>;
  try {
    body = InvokeBody.parse(JSON.parse(bodyText));
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const userId = session.userId;
  const threadId = body.thread_id;

  // Upsert thread row before kicking off upstream call.
  try {
    const existing = await getThread(userId, threadId);
    if (existing) {
      await updateThread(userId, threadId, {
        status: "running",
        lastMessageAt: new Date(),
      });
    } else {
      await createThread({
        userId,
        threadId,
        skill: body.skill ?? null,
        modelOverride: body.model_override ?? null,
      });
      await updateThread(userId, threadId, {
        status: "running",
        lastMessageAt: new Date(),
      });
    }
  } catch {
    return Response.json({ error: "db_error" }, { status: 500 });
  }

  const path = "/agents/km/invoke";
  const { headers } = signRequest({
    method: "POST",
    path,
    body: bodyText,
    userId,
    llmKey,
  });

  const upstream = await fetch(`${process.env.AGENTS_URL}${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: bodyText,
  });

  const setStatus = (status: AgentThreadStatus) => {
    // Fire-and-forget; never block the byte stream on DB writes.
    void updateThread(userId, threadId, {
      status,
      ...(status === "idle" || status === "error"
        ? { lastMessageAt: new Date() }
        : {}),
    }).catch((err) => {
      console.warn("[invoke] thread status update failed", status, err);
    });
  };

  if (!upstream.ok || !upstream.body) {
    setStatus("error");
    return new Response(upstream.body, { status: upstream.status });
  }

  const tapped = tapAgentEvents(upstream.body, setStatus);
  return new Response(tapped, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
