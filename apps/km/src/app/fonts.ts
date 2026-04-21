import { Fraunces, JetBrains_Mono } from "next/font/google";

export const fraunces = Fraunces({
  variable: "--font-prose-serif",
  subsets: ["latin"],
  display: "swap",
});

export const jetbrainsMono = JetBrains_Mono({
  variable: "--font-prose-mono",
  subsets: ["latin"],
  display: "swap",
});
