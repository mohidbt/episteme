import "./globals.css";
import type { ReactNode } from "react";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { fraunces, jetbrainsMono } from "./fonts";
import { Toaster } from "@/components/ui/sonner";
import { SpeedInsights } from "@vercel/speed-insights/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata = { title: "Episteme KM", description: "Knowledge manager" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} ${fraunces.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {children}
        <Toaster richColors position="bottom-right" />
        <SpeedInsights />
      </body>
    </html>
  );
}
