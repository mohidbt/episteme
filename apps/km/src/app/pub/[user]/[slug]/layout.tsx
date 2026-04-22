import "./reader.css";
import type { ReactNode } from "react";
import { fraunces } from "@/app/fonts";

export default function PubLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${fraunces.variable} min-h-screen bg-background text-foreground antialiased`}
    >
      {children}
    </div>
  );
}
