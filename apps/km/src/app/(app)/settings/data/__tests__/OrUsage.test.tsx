// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OrUsage } from "../OrUsage";

afterEach(() => cleanup());

describe("OrUsage", () => {
  it("renders 30-day spend vs limit and a progress bar", () => {
    render(
      <OrUsage usage={{ totalUsd: 1.23, byModel: [], isGuest: false, limitUsd: 5 }} />,
    );
    expect(screen.getByText(/\$1\.23 \/ \$5\.00/)).toBeTruthy();
    expect(screen.getByText(/30-day spend/i)).toBeTruthy();
    const fill = screen.getByTestId("or-usage-fill");
    // 1.23 / 5 = 24.6%
    expect((fill.getAttribute("style") ?? "")).toContain("width: 24.6%");
  });

  it("uses a $1 limit for guests", () => {
    render(
      <OrUsage usage={{ totalUsd: 0.5, byModel: [], isGuest: true, limitUsd: 1 }} />,
    );
    expect(screen.getByText(/\$0\.50 \/ \$1\.00/)).toBeTruthy();
  });

  it("shows 4 decimals for sub-cent spend so nano-model turns are visible", () => {
    render(
      <OrUsage usage={{ totalUsd: 0.002075, byModel: [], isGuest: false, limitUsd: 5 }} />,
    );
    expect(screen.getByText(/\$0\.0021 \/ \$5\.00/)).toBeTruthy();
  });

  it("shows an Over budget badge and clamps the bar at 100% when over", () => {
    render(
      <OrUsage usage={{ totalUsd: 6, byModel: [], isGuest: false, limitUsd: 5 }} />,
    );
    expect(screen.getByText(/Over budget/i)).toBeTruthy();
    const fill = screen.getByTestId("or-usage-fill");
    expect((fill.getAttribute("style") ?? "")).toContain("width: 100%");
  });
});
