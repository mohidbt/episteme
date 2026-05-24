// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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

  it("K12: web_search switch is ON by default when permission is undefined", () => {
    render(<PermissionToggles permissions={{}} onChange={vi.fn()} />);
    const sw = screen.getByLabelText(/web search/i, { selector: "input" }) as HTMLInputElement;
    // The headless switch uses aria-checked rather than the native checked attribute.
    const switchEl = sw.closest("[role='switch']") ?? sw.parentElement?.querySelector("[role='switch']");
    expect(switchEl?.getAttribute("aria-checked")).toBe("true");
  });

  it("K12: toggling off emits permissions.web_search=false", () => {
    const onChange = vi.fn();
    render(<PermissionToggles permissions={{}} onChange={onChange} />);
    const switchEl = screen.getByRole("switch", { name: /web search/i });
    fireEvent.click(switchEl);
    expect(onChange).toHaveBeenCalledWith({ web_search: false });
  });

  it("K12: explicit false stays off in the UI", () => {
    render(
      <PermissionToggles permissions={{ web_search: false }} onChange={vi.fn()} />,
    );
    const switchEl = screen.getByRole("switch", { name: /web search/i });
    expect(switchEl.getAttribute("aria-checked")).toBe("false");
  });
});
