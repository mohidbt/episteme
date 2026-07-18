import type { Metadata } from "next";
import { Geist_Mono, Outfit, Philosopher } from "next/font/google";
import "./landing.css";
import { Hero } from "./_components/Hero";
import { Features } from "./_components/Features";
import { UseCases } from "./_components/UseCases";
import { Quote } from "./_components/Quote";
import { ClosingCta } from "./_components/ClosingCta";
import { Footer } from "./_components/Footer";
import { StickyCta } from "./_components/StickyCta";
import { HideAppChrome } from "./_components/HideAppChrome";

// Marketing fonts, scoped to this route via CSS variables consumed by landing.css.
const mkSans = Outfit({ variable: "--font-mk-sans", subsets: ["latin"] });
const mkMono = Geist_Mono({ variable: "--font-mk-mono", subsets: ["latin"] });
const mkDisplay = Philosopher({
  variable: "--font-mk-display",
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Episteme: one workspace for everything you read, write, and cite",
  description:
    "Replace Obsidian, Zotero, Acrobat, and ChatGPT with one workspace. Papers, references, highlights, notes, and reading, unified.",
};

// GSD-151: the marketing landing is fully static (no per-request data). Pin it
// so it is prerendered at build time and can never silently regress to dynamic
// rendering if a request-time API is later introduced upstream.
export const dynamic = "force-static";

export default function LandingPage() {
  return (
    <main
      className={`mk-root ${mkSans.variable} ${mkMono.variable} ${mkDisplay.variable}`}
    >
      <HideAppChrome />
      <StickyCta />
      <Hero />
      <Features />
      <UseCases />
      <Quote />
      <ClosingCta />
      <Footer />
    </main>
  );
}
