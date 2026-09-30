import { test, expect } from "@playwright/test";
import {
  caretToEnd,
  createNote,
  editor,
  expectAiOutput,
  expectNoHorizontalOverflow,
  expectNothingLeftBehind,
  expectPopupSane,
  generatePanel,
  openNoteInPanel,
  papersWithPdf,
  rephraseBubble,
  screenshot,
  selectionRect,
  selectionToolbar,
  slashMenu,
  trashNote,
  type Dock,
  type Note,
  type Paper,
} from "./helpers";

// AI rewrite in the narrowest panel: from the slash menu (generate) and from
// the selection toolbar (rephrase). The panel has to be in a sane place while
// it asks for a prompt and once it shows the model's text, and accepting that
// text has to change the note. The model is the real one: nothing is stubbed.

const PARAGRAPHS = [
  "Reading notes are kept next to the paper, so the passage being quoted and the thought about it stay on one screen.",
  "A short last line",
];
const SEED = PARAGRAPHS.join("\n\n");

const CELLS: { viewport: { width: number; height: number }; dock: Dock }[] = [
  { viewport: { width: 1440, height: 900 }, dock: "right" },
  { viewport: { width: 1440, height: 900 }, dock: "left" },
  { viewport: { width: 1440, height: 900 }, dock: "bottom" },
  { viewport: { width: 1280, height: 720 }, dock: "right" },
  { viewport: { width: 1920, height: 1080 }, dock: "right" },
];

test.describe.configure({ mode: "parallel" });

let paper: Paper;
let note: Note;

test.beforeAll(async ({ request }) => {
  [paper] = await papersWithPdf(request);
  note = await createNote(request, paper.libraryId, SEED);
});

test.afterAll(async ({ request }) => {
  await trashNote(request, note);
});

for (const { viewport, dock } of CELLS) {
  const cell = `${viewport.width}x${viewport.height}-${dock}-minimum`;

  test(`AI rewrite at ${viewport.width}x${viewport.height}, dock ${dock}, size minimum`, async ({ page, request }) => {
    await openNoteInPanel(page, request, paper, note, SEED, { viewport, dock });

    await test.step("generate from the slash menu", async () => {
      await caretToEnd(page);
      await page.keyboard.press("Enter");
      await page.keyboard.type("/ai");
      await expect(slashMenu(page)).toContainText("Ask AI to write or edit");
      const line = await selectionRect(page);
      await page.keyboard.press("Enter");
      await expectPopupSane(generatePanel(page), line, "generate panel, prompting");
      await screenshot(page, `${cell}-ai-generate-prompt`);

      await page.keyboard.type("Write one short sentence about reading papers.");
      await page.keyboard.press("Enter");
      await expectAiOutput(generatePanel(page));
      await expectPopupSane(generatePanel(page), line, "generate panel, with output");
      await screenshot(page, `${cell}-ai-generate-output`);

      const before = await editor(page).innerText();
      await generatePanel(page).getByRole("button", { name: "Insert" }).click();
      await expectNothingLeftBehind(page);
      await expect.poll(() => editor(page).innerText()).not.toBe(before);
      await expectNoHorizontalOverflow(page);
    });

    await test.step("rephrase from the selection toolbar", async () => {
      const first = editor(page).locator("p").first();
      await first.click({ clickCount: 3 });
      const selection = await selectionRect(page);
      await expectPopupSane(selectionToolbar(page), selection, "selection toolbar");
      await selectionToolbar(page).getByRole("button", { name: "AI Rephrase" }).click();
      await expectPopupSane(rephraseBubble(page), selection, "rephrase panel, prompting");
      await screenshot(page, `${cell}-ai-rephrase-prompt`);

      await page.keyboard.type("Say this in completely different words.");
      await page.keyboard.press("Enter");
      await expectAiOutput(rephraseBubble(page));
      await expectPopupSane(rephraseBubble(page), selection, "rephrase panel, with output");
      await screenshot(page, `${cell}-ai-rephrase-output`);

      await rephraseBubble(page).getByRole("button", { name: "Replace" }).click();
      await expect(first).not.toHaveText(PARAGRAPHS[0]);
      await expectNothingLeftBehind(page);
      await expectNoHorizontalOverflow(page);
    });
  });
}
