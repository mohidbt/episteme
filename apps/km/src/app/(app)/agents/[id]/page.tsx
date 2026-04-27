import { notFound } from "next/navigation";
import { getRequiredUserId } from "@/lib/session";
import { getThread } from "@/lib/threads";
import { AgentTranscript } from "@/components/agent/AgentTranscript";

interface ThreadPageProps {
  params: Promise<{ id: string }>;
}

export default async function AgentThreadPage({ params }: ThreadPageProps) {
  const userId = await getRequiredUserId();
  const { id } = await params;
  const thread = await getThread(userId, id);
  if (!thread) notFound();
  return (
    <div className="h-full">
      <AgentTranscript fullHeight threadId={thread.threadId} />
    </div>
  );
}
