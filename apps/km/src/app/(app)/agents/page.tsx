import { getRequiredUserId } from "@/lib/session";
import { listThreadsForUser } from "@/lib/threads";
import { ThreadList } from "@/components/agent/ThreadList";
import { SkillsSection } from "@/components/agent/SkillsSection";
import { SKILLS } from "@/lib/skills";

export default async function AgentsPage() {
  const userId = await getRequiredUserId();
  const threads = await listThreadsForUser(userId);
  return (
    <div className="flex flex-col gap-8 p-6">
      <ThreadList initialThreads={threads} />
      <SkillsSection skills={SKILLS} />
    </div>
  );
}
