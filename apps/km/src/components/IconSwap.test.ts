// @vitest-environment jsdom
// G-R4-07 (#102) — Verify no Wand2/Sparkles lucide imports remain in AI icon
// components; the glyph "⬡" must be used instead.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const COMPONENTS_DIR = resolve(__dirname);

const FILES_WITH_ICON: string[] = [
  "AiBubbleMenu.tsx",
  "AiFillButton.tsx",
  "AiFillBatchButton.tsx",
  "ReferenceAgenticSearchButton.tsx",
  "SlashCommandTypeahead.tsx",
  // Also covers PapersetToolbar which uses the same icon
  "../app/(app)/d/[id]/PapersetToolbar.tsx",
];

describe("G-R4-07 #102 — Wand2/Sparkles icon swap", () => {
  for (const file of FILES_WITH_ICON) {
    const abs = resolve(COMPONENTS_DIR, file);
    let src: string;
    try {
      src = readFileSync(abs, "utf-8");
    } catch {
      it.skip(`${file}: file not found, skipping`, () => {});
      continue;
    }

    describe(file, () => {
      it("has no Wand2 import from lucide-react", () => {
        expect(src).not.toMatch(/import\s+.*Wand2.*from\s+["']lucide-react["']/);
      });

      it("has no Sparkles import from lucide-react", () => {
        expect(src).not.toMatch(/import\s+.*Sparkles.*from\s+["']lucide-react["']/);
      });

      it("does not render <Wand2 as JSX", () => {
        expect(src).not.toMatch(/<Wand2[\s/>]/);
      });

      it("does not render <Sparkles as JSX", () => {
        expect(src).not.toMatch(/<Sparkles[\s/>]/);
      });

      if (file === "SlashCommandTypeahead.tsx") {
        it('AI command uses "⬡" glyph instead of "✨"', () => {
          expect(src).not.toContain('"✨"');
          // The AI icon field should use the glyph
          expect(src).toContain("⬡");
        });
      }

      if (file !== "SlashCommandTypeahead.tsx") {
        it("uses the ⬡ glyph (span or text) for the AI icon", () => {
          // Either a <span>⬡</span> or the glyph appears in className context
          expect(src).toContain("⬡");
        });
      }
    });
  }
});

describe("G-R4-07 #109 — Slash menu hover styling", () => {
  const commandPath = resolve(COMPONENTS_DIR, "ui", "command.tsx");
  const src = readFileSync(commandPath, "utf-8");

  it("CommandItem has hover:bg-muted or equivalent hover highlight class", () => {
    // The CommandItem className should include a hover: class for background
    expect(src).toMatch(/hover:bg-/);
  });
});