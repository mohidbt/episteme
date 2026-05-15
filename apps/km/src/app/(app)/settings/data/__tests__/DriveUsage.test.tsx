// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DriveUsage } from "../DriveUsage";

afterEach(() => cleanup());

const MB = 1024 * 1024;

describe("DriveUsage", () => {
  it("renders a breakdown line with rounded MB values and totals", () => {
    render(
      <DriveUsage
        usage={{
          papers: 10 * MB,
          notes: 2 * MB,
          assets: 5 * MB,
          total: 17 * MB,
        }}
      />,
    );
    // total ↦ "17.0 MB / 100 MB used"
    expect(screen.getByText(/17(\.0)? MB \/ 100 MB used/)).toBeTruthy();
    expect(screen.getByText(/Papers 10/)).toBeTruthy();
    expect(screen.getByText(/Notes 2/)).toBeTruthy();
    expect(screen.getByText(/Assets 5/)).toBeTruthy();
  });

  it("renders a progress bar with width proportional to total/limit", () => {
    const { container } = render(
      <DriveUsage
        usage={{ papers: 0, notes: 0, assets: 25 * MB, total: 25 * MB }}
      />,
    );
    const bar = container.querySelector("[data-testid='drive-usage-bar']");
    expect(bar).toBeTruthy();
    const inner = bar?.querySelector("[data-testid='drive-usage-fill']");
    expect(inner).toBeTruthy();
    const style = (inner as HTMLElement).getAttribute("style") ?? "";
    expect(style).toContain("width: 25%");
  });

  it("shows an over-limit badge and clamps bar to 100% when over the cap", () => {
    render(
      <DriveUsage
        usage={{
          papers: 110 * MB,
          notes: 0,
          assets: 0,
          total: 110 * MB,
        }}
      />,
    );
    expect(screen.getByText(/Over limit/i)).toBeTruthy();
    const fill = screen.getByTestId("drive-usage-fill");
    expect(fill.getAttribute("style") ?? "").toContain("width: 100%");
  });
});
