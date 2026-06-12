import type { ReactNode } from "react";
import { getCurrentSession } from "@/lib/session";
import { getUserPreferences } from "@/lib/preferences-server";
import { Sidebar } from "@/components/Sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AnonAutoSignIn } from "@/components/AnonAutoSignIn";
import { AgentBall } from "@/components/agent/AgentBall";
import { AgentBallProvider } from "@/components/agent/agent-ball-context";
import { AppDndContext } from "./app-dnd-context";
import { AutoRefreshOnFocus } from "@/components/AutoRefreshOnFocus";
import { TabBar, TabBarProvider } from "@/components/TabBar";
import { GuestTour } from "@/components/guest-tour/GuestTour";
import { getGuestTourTargets, type GuestTourTargets } from "@/lib/guest-tour/seed-targets";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getCurrentSession();
  if (!session) return <AnonAutoSignIn />;
  const prefs = await getUserPreferences(session.userId);
  let guestTourTargets: GuestTourTargets | null = null;
  if (session.isAnonymous) {
    try {
      guestTourTargets = await getGuestTourTargets(session.userId);
    } catch {
      guestTourTargets = null;
    }
  }
  return (
    <AgentBallProvider>
      <TabBarProvider isAnonymous={session.isAnonymous}>
       <AppDndContext>
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
          <GuestTour isAnonymous={session.isAnonymous} seedTargets={guestTourTargets} />
        </SidebarProvider>
       </AppDndContext>
      </TabBarProvider>
    </AgentBallProvider>
  );
}
