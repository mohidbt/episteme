import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Geist_Mono, Outfit, Philosopher } from "next/font/google";
import { fraunces, jetbrainsMono } from "./fonts";
import { Toaster } from "@/components/ui/sonner";
import { MobileGate } from "@/components/MobileGate";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";

const outfit = Outfit({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const philosopher = Philosopher({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Episteme",
  description: "Knowledge manager",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: ["/icon.svg"],
    apple: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${geistMono.variable} ${philosopher.variable} ${fraunces.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {children}
        <MobileGate />
        <Toaster position="bottom-right" />
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
