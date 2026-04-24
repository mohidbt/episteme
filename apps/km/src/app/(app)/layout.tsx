import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/session";
import { getUserPreferences } from "@/lib/preferences-server";
import { Sidebar } from "@/components/Sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/sign-in");
  const prefs = await getUserPreferences(userId);
  return (
    <SidebarProvider className="h-dvh overflow-hidden">
      <Sidebar userId={userId} />
      <main
        className="flex-1 min-w-0 h-dvh overflow-y-auto"
        data-prose-font={prefs.font}
        data-prose-ruled={prefs.ruledLines ? "true" : "false"}
      >
        {children}
      </main>
    </SidebarProvider>
  );
}
