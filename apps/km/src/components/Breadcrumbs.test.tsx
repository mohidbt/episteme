// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Breadcrumbs } from "./Breadcrumbs";

afterEach(() => cleanup());

describe("Breadcrumbs", () => {
  it("renders papersets section link to /papersets", () => {
    render(
      <Breadcrumbs
        libraryName="My Library"
        section="papersets"
        folderPath="Research/Topics/"
        title="analysis.csv"
      />,
    );

    const sectionLink = screen.getByRole("link", { name: "Papersets" });
    expect(sectionLink.getAttribute("href")).toBe("/papersets");

    const libraryLink = screen.getByRole("link", { name: "My Library" });
    expect(libraryLink.getAttribute("href")).toBe("/");

    expect(screen.getByText("Research")).toBeTruthy();
    expect(screen.getByText("Topics")).toBeTruthy();
    expect(screen.getByText("analysis.csv")).toBeTruthy();
  });
});
