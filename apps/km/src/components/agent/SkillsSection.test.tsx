// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SkillsSection } from "./SkillsSection";
import { SKILLS } from "@/lib/skills";

afterEach(cleanup);

describe("SkillsSection", () => {
  it("renders one row per canonical SKILL", () => {
    render(<SkillsSection skills={SKILLS} />);
    const rows = screen.getAllByTestId("agents-skill-row");
    expect(rows.length).toBe(SKILLS.length);
    for (const skill of SKILLS) {
      expect(screen.getByText(skill.title)).toBeTruthy();
    }
  });

  it("renders nothing in the list when given an empty list", () => {
    render(<SkillsSection skills={[]} />);
    expect(screen.queryAllByTestId("agents-skill-row").length).toBe(0);
  });
});
