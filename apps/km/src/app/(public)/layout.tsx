import type { ReactNode } from "react";

// GSD-151: slim layout for public/marketing routes (currently just /landing).
// Intentionally minimal — it mounts no desktop gate, no error-reporting
// feedback widget, and no auth-gated app providers, and reads no request-time
// APIs, so routes in this group stay statically prerenderable. The full app
// chrome lives in the sibling (app) route group.
export default function PublicLayout({ children }: { children: ReactNode }) {
  return children;
}
