import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getCurrentUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { agentConfigs } from "@episteme/db/schema";
import { PermissionsForm } from "@/components/settings/PermissionsForm";

export default async function AgentsSettingsPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");

  const rows = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, userId));

  let row = rows[0];
  if (!row) {
    const inserted = await db
      .insert(agentConfigs)
      .values({ userId })
      .onConflictDoUpdate({
        target: agentConfigs.userId,
        set: { updatedAt: new Date() },
      })
      .returning();
    row = inserted[0];
  }

  const initial = {
    enabledSkills: row.enabledSkills ?? [],
    attachedMcps: (row.attachedMcps ?? []) as Array<{
      name: string;
      account?: string;
    }>,
    modelPreference: row.modelPreference ?? "google/gemma-4-31b-it:free",
    approvalRules: (row.approvalRules ?? {}) as Record<
      string,
      "auto" | "require" | "never"
    >,
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="font-display text-2xl mb-1">Permissions &amp; MCP</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Control which skills, tools, and models your agents can use.
      </p>
      <PermissionsForm initial={initial} />
    </div>
  );
}
