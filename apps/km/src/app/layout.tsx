import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Episteme KM", description: "Knowledge manager" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
