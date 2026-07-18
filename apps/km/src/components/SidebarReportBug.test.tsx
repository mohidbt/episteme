// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { SidebarProvider } from "@/components/ui/sidebar";

const openFeedbackDialog = vi.fn();
vi.mock("@/lib/sentry/open-feedback", () => ({
  openFeedbackDialog: () => openFeedbackDialog(),
}));

import { SidebarReportBug } from "./SidebarReportBug";

// SidebarMenuButton reads useSidebar() — it must render inside a provider.
const renderItem = () =>
  render(
    <SidebarProvider>
      <SidebarReportBug />
    </SidebarProvider>,
  );

describe("SidebarReportBug (GSD-220)", () => {
  beforeEach(() => {
    openFeedbackDialog.mockReset();
    // SidebarProvider → useSidebar → use-mobile reads window.matchMedia,
    // which jsdom does not implement.
    if (typeof window.matchMedia !== "function") {
      window.matchMedia = () =>
        ({
          matches: false,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList;
    }
  });
  afterEach(() => cleanup());

  it("renders a Report a bug trigger button", () => {
    const { getByRole } = renderItem();
    expect(getByRole("button", { name: /report a bug/i })).toBeTruthy();
  });

  it("opens the Sentry feedback dialog on click", () => {
    const { getByRole } = renderItem();
    fireEvent.click(getByRole("button", { name: /report a bug/i }));
    expect(openFeedbackDialog).toHaveBeenCalledOnce();
  });
});
