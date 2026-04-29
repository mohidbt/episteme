// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ByTypeNav } from "./ByTypeNav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

afterEach(() => cleanup());

function renderNav() {
  return render(
    <SidebarProvider>
      <ByTypeNav />
    </SidebarProvider>,
  );
}

describe("ByTypeNav", () => {
  it("renders Papersets entry with /papersets href", () => {
    renderNav();
    const link = screen.getByRole("link", { name: /papersets/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/papersets");
  });

  it("renders Papers, References, Notes, Papersets links", () => {
    const { container } = renderNav();
    const byHref = (h: string) =>
      container.querySelector(`a[href="${h}"]`) as HTMLAnchorElement | null;
    expect(byHref("/papers")).toBeTruthy();
    expect(byHref("/references")).toBeTruthy();
    expect(byHref("/notes")).toBeTruthy();
    expect(byHref("/papersets")).toBeTruthy();
  });
});
