import { getRequiredUserId } from "@/lib/session";
import { listThreadsForUser } from "@/lib/threads";
import { ThreadList } from "@/components/agent/ThreadList";

export default async function AgentsPage() {
  const userId = await getRequiredUserId();
  const threads = await listThreadsForUser(userId);
  return (
    <div className="p-6">
      <ThreadList initialThreads={threads} />
    </div>
  );
}
