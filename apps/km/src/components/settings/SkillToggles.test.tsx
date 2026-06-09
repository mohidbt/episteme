// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { SkillToggles } from "./SkillToggles";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => {
    return new Response(new Blob(["zipbytes"], { type: "application/zip" }), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition":
          'attachment; filename="episteme-agent-config-u-1.zip"',
      },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

describe("SkillToggles export (K1 — server-side bundle)", () => {
  it("renders an Export skills button", () => {
    render(<SkillToggles enabledSkills={[]} onChange={() => {}} />);
    expect(screen.getByTestId("export-skills-button")).toBeTruthy();
  });

  it("clicking Export fetches /api/agent/export-skills and triggers a download", async () => {
    const createUrl = vi.fn(() => "blob:mock");
    const revokeUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeUrl,
    });

    render(<SkillToggles enabledSkills={[]} onChange={() => {}} />);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();
    fireEvent.click(screen.getByTestId("export-skills-button"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/agent/export-skills",
        expect.objectContaining({ method: "GET" }),
      );
    });
    expect(createUrl).toHaveBeenCalled();
  });
});

describe("SkillToggles layout (#143)", () => {
  it("renders Export skills button after the system skills section", () => {
    render(<SkillToggles enabledSkills={[]} onChange={() => {}} />);
    const heading = screen.getByTestId("system-skills-heading");
    const exportBtn = screen.getByTestId("export-skills-button");
    expect(
      heading.compareDocumentPosition(exportBtn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
