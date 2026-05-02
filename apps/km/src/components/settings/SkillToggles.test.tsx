// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const mockGenerateAsync = vi.fn(async () => new Blob(["zip"], { type: "application/zip" }));
const mockFile = vi.fn();
vi.mock("jszip", () => {
  return {
    default: class MockJSZip {
      file = mockFile;
      generateAsync = mockGenerateAsync;
    },
  };
});

import { SkillToggles } from "./SkillToggles";
import { SKILLS } from "@/lib/skills";

beforeEach(() => {
  mockFile.mockReset();
  mockGenerateAsync.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SkillToggles export", () => {
  it("renders an Export skills button", () => {
    render(<SkillToggles enabledSkills={[]} onChange={() => {}} />);
    expect(screen.getByTestId("export-skills-button")).toBeTruthy();
  });

  it("clicking Export triggers JSZip + a download", async () => {
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
    fireEvent.click(screen.getByTestId("export-skills-button"));

    await waitFor(() => {
      expect(mockGenerateAsync).toHaveBeenCalled();
    });
    // One file written per canonical skill.
    expect(mockFile).toHaveBeenCalledTimes(SKILLS.length);
    // Each file is named <skill>/SKILL.md.
    for (const skill of SKILLS) {
      const found = mockFile.mock.calls.some(
        (args) => args[0] === `${skill.name}/SKILL.md`,
      );
      expect(found).toBe(true);
    }
    expect(createUrl).toHaveBeenCalled();
  });
});

describe("SkillToggles layout (#143)", () => {
  it("renders Export skills button after the system skills section", () => {
    render(<SkillToggles enabledSkills={[]} onChange={() => {}} />);
    const heading = screen.getByTestId("system-skills-heading");
    const exportBtn = screen.getByTestId("export-skills-button");
    // Export button should come AFTER the skills heading in DOM order
    expect(
      heading.compareDocumentPosition(exportBtn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
