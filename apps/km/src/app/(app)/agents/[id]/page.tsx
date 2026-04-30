import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getRequiredUserId } from "@/lib/session";
import { getThread } from "@/lib/threads";
import { AgentTranscript } from "@/components/agent/AgentTranscript";

interface ThreadPageProps {
  params: Promise<{ id: string }>;
}

interface PersistedMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

async function fetchInitialMessages(
  threadId: string,
  cookie: string,
): Promise<PersistedMessage[]> {
  // Reuse the existing /api/agents/km/state proxy — it round-trips to the
  // FastAPI agent and returns the deep-agents checkpointer message list.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  if (!host) return [];
  try {
    const res = await fetch(
      `${proto}://${host}/api/agents/km/state/${threadId}`,
      { headers: { cookie }, cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { messages?: PersistedMessage[] };
    return Array.isArray(data.messages) ? data.messages : [];
  } catch {
    return [];
  }
}

export default async function AgentThreadPage({ params }: ThreadPageProps) {
  const userId = await getRequiredUserId();
  const { id } = await params;
  const thread = await getThread(userId, id);
  if (!thread) notFound();
  const h = await headers();
  const cookie = h.get("cookie") ?? "";
  const initialMessages = await fetchInitialMessages(thread.threadId, cookie);
  return (
    <div className="h-full">
      <AgentTranscript
        fullHeight
        threadId={thread.threadId}
        initialMessages={initialMessages}
      />
    </div>
  );
}
