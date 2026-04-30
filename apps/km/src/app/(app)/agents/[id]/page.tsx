import { notFound } from "next/navigation";
import { getRequiredUserId } from "@/lib/session";
import { getThread } from "@/lib/threads";
import { getThreadMessages } from "@/lib/agents/get-thread-messages";
import { AgentTranscript } from "@/components/agent/AgentTranscript";

interface ThreadPageProps {
  params: Promise<{ id: string }>;
}

export default async function AgentThreadPage({ params }: ThreadPageProps) {
  const userId = await getRequiredUserId();
  const { id } = await params;

  // Issue #65: fan out the two reads in parallel, and call FastAPI directly
  // for the message list instead of round-tripping through our own
  // /api/agents/km/state route handler over loopback. Saves one HTTP hop +
  // one HMAC sign per page load.
  const [thread, initialMessages] = await Promise.all([
    getThread(userId, id),
    getThreadMessages(userId, id),
  ]);
  if (!thread) notFound();

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
