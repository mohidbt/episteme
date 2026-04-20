import Link from "next/link";
import { UserMenu } from "@/components/auth/user-menu";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link
              href="/library"
              className="font-semibold text-lg tracking-tight"
            >
              inhale
            </Link>
            <Link
              href="/library"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Library
            </Link>
            <Link
              href="/library/references"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              References
            </Link>
            <Link
              href="/settings"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Settings
            </Link>
          </div>
          <UserMenu />
        </nav>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
