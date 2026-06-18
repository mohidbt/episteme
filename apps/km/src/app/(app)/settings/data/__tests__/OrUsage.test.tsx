// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OrUsage } from "../OrUsage";

afterEach(() => cleanup());

describe("OrUsage — GSD-126 P0 bar-only swap", () => {
  it("does NOT render a numeric '$X / $Y' readout", () => {
    render(
      <OrUsage
        usage={{ totalUsd: 1.23, byModel: [], isGuest: false, limitUsd: 5 }}
      />,
    );
    // Numeric readout and the "30-day spend" qualifier are both dropped.
    expect(screen.queryByText(/\$1\.23/)).toBeNull();
    expect(screen.queryByText(/30-day spend/i)).toBeNull();
  });

  it("renders the 'AI usage' label for guests (no time qualifier)", () => {
    render(
      <OrUsage
        usage={{ totalUsd: 0.1, byModel: [], isGuest: true, limitUsd: 1 }}
      />,
    );
    expect(screen.getByText("AI usage")).toBeTruthy();
    // No weekly/30-day qualifier on guest path.
    expect(screen.queryByText(/Weekly usage/i)).toBeNull();
  });

  it("renders the 'Weekly usage' label for signed-in users", () => {
    render(
      <OrUsage
        usage={{ totalUsd: 1.23, byModel: [], isGuest: false, limitUsd: 5 }}
      />,
    );
    expect(screen.getByText("Weekly usage")).toBeTruthy();
    expect(screen.queryByText(/AI usage/i)).toBeNull();
  });

  it("fills the bar to the correct percentage of limit", () => {
    render(
      <OrUsage
        usage={{ totalUsd: 1.25, byModel: [], isGuest: false, limitUsd: 5 }}
      />,
    );
    const fill = screen.getByTestId("or-usage-fill");
    // 1.25 / 5 = 25%
    expect(fill.getAttribute("style") ?? "").toContain("width: 25%");
  });

  it("clamps the bar at 100% and shows Over budget badge when over limit", () => {
    render(
      <OrUsage
        usage={{ totalUsd: 6, byModel: [], isGuest: false, limitUsd: 5 }}
      />,
    );
    expect(screen.getByText(/Over budget/i)).toBeTruthy();
    const fill = screen.getByTestId("or-usage-fill");
    expect(fill.getAttribute("style") ?? "").toContain("width: 100%");
  });

  it("renders 0% width when limit is 0 (guard divide-by-zero)", () => {
    render(
      <OrUsage
        usage={{ totalUsd: 0, byModel: [], isGuest: true, limitUsd: 0 }}
      />,
    );
    const fill = screen.getByTestId("or-usage-fill");
    expect(fill.getAttribute("style") ?? "").toContain("width: 0%");
  });
});
