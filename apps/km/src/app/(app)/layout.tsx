import type { ReactNode } from "react";
import { getCurrentSession } from "@/lib/session";
import { getUserPreferences } from "@/lib/preferences-server";
import { Sidebar } from "@/components/Sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AnonAutoSignIn } from "@/components/AnonAutoSignIn";
import { AgentBall } from "@/components/agent/AgentBall";
import { AgentBallProvider } from "@/components/agent/agent-ball-context";
import { AutoRefreshOnFocus } from "@/components/AutoRefreshOnFocus";
import { TabBar, TabBarProvider } from "@/components/TabBar";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getCurrentSession();
  if (!session) return <AnonAutoSignIn />;
  const prefs = await getUserPreferences(session.userId);
  return (
    <AgentBallProvider>
      <TabBarProvider isAnonymous={session.isAnonymous}>
        <SidebarProvider className="h-dvh overflow-hidden">
          <Sidebar userId={session.userId} isAnonymous={session.isAnonymous} />
          <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden bg-[var(--bg-roof)]">
            <TabBar />
            <main
              className="flex-1 min-w-0 overflow-y-auto bg-background rounded-tl-xl border-l border-[var(--roof-border)]"
              data-prose-font={prefs.font}
              data-prose-ruled={prefs.ruledLines ? "true" : "false"}
            >
              {children}
            </main>
          </div>
          <AgentBall userId={session.userId} />
          <AutoRefreshOnFocus />
        </SidebarProvider>
      </TabBarProvider>
    </AgentBallProvider>
  );
}
