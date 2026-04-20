import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/session";
import { Sidebar } from "@/components/Sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/");
  return (
    <SidebarProvider className="min-h-screen">
      <Sidebar userId={userId} />
      <main className="flex-1 min-w-0">{children}</main>
    </SidebarProvider>
  );
}
