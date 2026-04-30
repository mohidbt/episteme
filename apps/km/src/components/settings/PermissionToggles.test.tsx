// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PermissionToggles } from "./PermissionToggles";

afterEach(() => cleanup());

describe("PermissionToggles", () => {
  it("does not mention Tavily in the rendered UI (RG1 #66)", () => {
    const { container } = render(
      <PermissionToggles permissions={{}} onChange={vi.fn()} />,
    );
    expect(container.textContent ?? "").not.toMatch(/tavily/i);
  });

  it("renders the web_search toggle with neutral 'Web search' label", () => {
    render(<PermissionToggles permissions={{}} onChange={vi.fn()} />);
    const label = screen.getByLabelText(/web search/i, { selector: "input" });
    expect(label.id).toBe("perm-web_search");
  });
});
