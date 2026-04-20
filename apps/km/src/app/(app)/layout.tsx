import type { ReactNode } from "react";
import { getCurrentUserId } from "@/lib/session";
import { Sidebar } from "@/components/Sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <p className="font-display text-2xl tracking-tight">Not signed in</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to access your library.
          </p>
        </div>
      </main>
    );
  }
  return (
    <SidebarProvider className="min-h-screen">
      <Sidebar userId={userId} />
      <main className="flex-1 min-w-0">{children}</main>
    </SidebarProvider>
  );
}
