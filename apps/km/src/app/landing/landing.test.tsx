// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

afterEach(() => cleanup());

// next/font/google is unavailable in the vitest (node) environment; stub it so
// the landing page module (which loads fonts) can import cleanly.
vi.mock("next/font/google", () => ({
  Philosopher: () => ({ variable: "--font-display", className: "philosopher" }),
  Outfit: () => ({ variable: "--font-sans", className: "outfit" }),
  Geist_Mono: () => ({ variable: "--font-mono", className: "geist-mono" }),
}));

// Route-scoped CSS import is a side effect; stub it out for the unit test.
vi.mock("./landing.css", () => ({}));

import LandingPage from "./page";

const EM_DASH = "\u2014"; // em-dash; must never appear in rendered landing text

function renderLanding() {
  return render(<LandingPage />);
}

describe("Landing page", () => {
  it("renders the hero with the approved H1 and eyebrow", () => {
    renderLanding();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /Replace Obsidian, Zotero, Acrobat, and ChatGPT with one workspace\./i,
      }),
    ).toBeTruthy();
    expect(screen.getByText(/^Limited beta · invite only$/i)).toBeTruthy();
  });

  it("renders both primary CTAs with correct hrefs", () => {
    renderLanding();
    const signupLinks = screen.getAllByRole("link", { name: /sign up free/i });
    expect(signupLinks.length).toBeGreaterThanOrEqual(1);
    for (const link of signupLinks) {
      expect(link.getAttribute("href")).toBe("/sign-up");
    }
    const openLinks = screen.getAllByRole("link", { name: /open the app/i });
    expect(openLinks.length).toBeGreaterThanOrEqual(1);
    for (const link of openLinks) {
      expect(link.getAttribute("href")).toBe("https://app.tryepisteme.com");
    }
  });

  it("renders the mess section copy", () => {
    renderLanding();
    expect(
      screen.getByRole("heading", {
        name: /Your research is scattered across five tools\./i,
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Obsidian for notes\. Zotero for references\./i),
    ).toBeTruthy();
  });

  it("renders the tool chips struck through and the episteme mark", () => {
    renderLanding();
    for (const tool of ["Obsidian", "Zotero", "Acrobat", "ChatGPT"]) {
      // Chips carry .mk-tool-chip, which the route stylesheet strikes through.
      const chip = screen.getByText(tool, { selector: ".mk-tool-chip" });
      expect(chip.classList.contains("mk-tool-chip")).toBe(true);
    }
    expect(
      screen.getByText("Episteme", { selector: ".mk-tool-after span" }),
    ).toBeTruthy();
  });

  it("renders the unlock section copy", () => {
    renderLanding();
    expect(
      screen.getByRole("heading", {
        name: /Because it's all in one place, an assistant can actually help\./i,
      }),
    ).toBeTruthy();
  });

  it("renders all four use-case cards", () => {
    renderLanding();
    expect(screen.getByText(/An assistant with your full context\./i)).toBeTruthy();
    expect(
      screen.getByText(/Reading becomes a diff against your worldview\./i),
    ).toBeTruthy();
    expect(screen.getByText(/Skim 50 papers at once\./i)).toBeTruthy();
    expect(screen.getByText(/A story you can trace, and hand over\./i)).toBeTruthy();
  });

  it("renders the Aristotle quote without an em-dash", () => {
    renderLanding();
    const quote = screen.getByText(
      /knowledge that is grasped, reasoned, and held against the world/i,
    );
    expect(quote).toBeTruthy();
    expect(quote.textContent).not.toContain(EM_DASH);
  });

  it("renders the closing CTA band copy", () => {
    renderLanding();
    expect(
      screen.getByText(/Bring your research into one place\./i),
    ).toBeTruthy();
    expect(
      screen.getByText(/Episteme is in limited beta\. Invite only for now\./i),
    ).toBeTruthy();
  });

  it("renders the minimal footer with tagline and copyright", () => {
    renderLanding();
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText(/Knowledge, grasped\./i)).toBeTruthy();
    expect(within(footer).getByText(/© 2026 Episteme Labs/i)).toBeTruthy();
  });

  it("contains NO em-dash anywhere in the rendered text", () => {
    const { container } = renderLanding();
    expect(container.textContent ?? "").not.toContain(EM_DASH);
  });
});
