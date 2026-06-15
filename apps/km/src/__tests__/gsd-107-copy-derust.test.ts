// GSD-107: lock approved copy strings against regression.
// Asserts exact substrings present in source files. If anyone edits
// these strings, tests fail and they must update both here and the
// approved-copy list in the Linear issue.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

describe("GSD-107: SignupForm descriptionForStep copy", () => {
  const src = read("src/app/sign-up/SignupForm.tsx");

  it("identity step copy", () => {
    expect(src).toContain('"How should your account show up?"');
  });
  it("email step copy", () => {
    expect(src).toContain('"What email do you want to use?"');
  });
  it("persona step copy", () => {
    expect(src).toContain('"Which fits you best?"');
  });
  it("persona-detail step copy", () => {
    expect(src).toContain('"A bit more about you"');
  });
  it("starter step copy", () => {
    expect(src).toContain('"Pick your starter"');
  });
  it("invite step copy", () => {
    expect(src).toContain('"Got an invite code?"');
  });
  it("password step copy", () => {
    expect(src).toContain('"Set your password"');
  });
});

describe("GSD-107: GuestTour step copy", () => {
  const src = read("src/components/guest-tour/GuestTour.tsx");

  it("drive_intro content", () => {
    expect(src).toContain(
      "Your library has 4 things: Notes, Papers, References, and Images. All searchable, all linked.",
    );
  });
  it("notes_collection content", () => {
    expect(src).toContain(
      "Notes is writing space, where your ideas and connections live. Type [[ to link any paper, reference, or other note. Import button (top-right) pulls markdown files -> you can bulk load your Obsidian vault.",
    );
  });
  it("references_collection content", () => {
    expect(src).toContain(
      "References are citations without the PDF — author, title, year, DOI. Import handles BibTeX, RIS, and EndNote files.",
    );
  });
  it("wow_refs_fill caption", () => {
    expect(src).toContain(
      "Drop a half-filled reference. The agent fills in DOI, authors, year, and abstract.",
    );
  });
  it("graph_intro caption", () => {
    expect(src).toContain(
      "Lines show explicit connections. Distance shows how similar papers read — closer means more alike.",
    );
  });
});
