import type { ReactNode } from "react";
import { getCurrentSession } from "@/lib/session";
import { getUserPreferences } from "@/lib/preferences-server";
import { Sidebar } from "@/components/Sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AnonAutoSignIn } from "@/components/AnonAutoSignIn";
import { AgentBall } from "@/components/agent/AgentBall";
import { AutoRefreshOnFocus } from "@/components/AutoRefreshOnFocus";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getCurrentSession();
  if (!session) return <AnonAutoSignIn />;
  const prefs = await getUserPreferences(session.userId);
  return (
    <SidebarProvider className="h-dvh overflow-hidden py-2 pr-2">
      <Sidebar userId={session.userId} isAnonymous={session.isAnonymous} />
      <main
        className="flex-1 min-w-0 h-full overflow-y-auto"
        data-prose-font={prefs.font}
        data-prose-ruled={prefs.ruledLines ? "true" : "false"}
      >
        {children}
      </main>
      <AgentBall userId={session.userId} />
      <AutoRefreshOnFocus />
    </SidebarProvider>
  );
}
