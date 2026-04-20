import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { OutlineSidebar } from "../outline-sidebar";

describe("OutlineSidebar", () => {
  afterEach(cleanup);

  it("always shows both Pages and Contents tabs", () => {
    const onNav = vi.fn();
    render(<OutlineSidebar totalPages={5} pdfOutline={null} onNavigate={onNav} />);
    expect(screen.getByRole("tab", { name: /pages/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /contents/i })).toBeTruthy();
  });

  it("shows empty-state copy in Contents when no outline exists", () => {
    render(<OutlineSidebar totalPages={5} pdfOutline={null} onNavigate={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /contents/i }));
    expect(screen.getByText(/no table of contents/i)).toBeTruthy();
  });

  it("shows Contents tree when pdfOutline is non-empty", () => {
    const outline = [{ title: "Intro", pageIndex: 0, items: [] }];
    render(<OutlineSidebar totalPages={5} pdfOutline={outline} onNavigate={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /contents/i }));
    expect(screen.getByText("Intro")).toBeTruthy();
  });
});
