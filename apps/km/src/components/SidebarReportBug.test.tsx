// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

const openFeedbackDialog = vi.fn();
vi.mock("@/lib/sentry/open-feedback", () => ({
  openFeedbackDialog: () => openFeedbackDialog(),
}));

import { SidebarReportBug } from "./SidebarReportBug";

describe("SidebarReportBug (GSD-220)", () => {
  beforeEach(() => openFeedbackDialog.mockReset());
  afterEach(() => cleanup());

  it("renders a Report a bug trigger button", () => {
    const { getByRole } = render(<SidebarReportBug />);
    expect(getByRole("button", { name: /report a bug/i })).toBeTruthy();
  });

  it("opens the Sentry feedback dialog on click", () => {
    const { getByRole } = render(<SidebarReportBug />);
    fireEvent.click(getByRole("button", { name: /report a bug/i }));
    expect(openFeedbackDialog).toHaveBeenCalledOnce();
  });
});
