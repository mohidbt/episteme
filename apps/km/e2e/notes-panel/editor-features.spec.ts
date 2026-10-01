import { test, expect, type Page } from "@playwright/test";
import {
  caretToEndOf,
  createNote,
  editor,
  expectNoHorizontalOverflow,
  expectNothingLeftBehind,
  expectPopupSane,
  generatePanel,
  linkBubble,
  linkEditForm,
  linkPopover,
  openNoteInPanel,
  panel,
  panelBody,
  papersWithPdf,
  pdf,
  pointOfText,
  rectOf,
  screenshot,
  selectionRect,
  selectionToolbar,
  slashMenu,
  tableMenu,
  trashNote,
  type Note,
  type Paper,
} from "./helpers";

// Every standard editor feature, once, in the narrowest panel: docked right,
// dragged to its minimum, in a 1440x900 window.

test.describe.configure({ mode: "parallel" });

let paper: Paper;
let note: Note;
/** What the wiki link tests link to. */
let target: Note;

test.beforeAll(async ({ request }) => {
  [paper] = await papersWithPdf(request);
  target = await createNote(request, paper.libraryId, "The linked note.");
  note = await createNote(request, paper.libraryId);
});

test.afterAll(async ({ request }) => {
  await trashNote(request, note);
  await trashNote(request, target);
});

/** How far `el` can scroll sideways, and whether its own box lets it. */
const sideways = (el: Element) => ({
  overflow: el.scrollWidth - el.clientWidth,
  scrolls: ["auto", "scroll"].includes(getComputedStyle(el).overflowX),
});

test("every slash command opens at the caret and does its job", async ({ page, request }) => {
  await openNoteInPanel(page, request, paper, note, "Slash commands");
  const first = editor(page).locator("p").first();

  /** Type `/query` on a new line under the first paragraph and run the command. */
  const run = async (query: string, description: string) => {
    await caretToEndOf(first);
    await page.keyboard.press("Enter");
    await page.keyboard.type(`/${query}`);
    await expect(slashMenu(page)).toContainText(description);
    const line = await selectionRect(page);
    await expectPopupSane(slashMenu(page), line, `slash menu, /${query}`);
    await page.keyboard.press("Enter");
    return line;
  };

  await test.step("AI", async () => {
    const line = await run("ai", "Ask AI to write or edit");
    await expectPopupSane(generatePanel(page), line, "generate panel");
    await page.keyboard.press("Escape");
    await expectNothingLeftBehind(page);
  });

  await test.step("Cite", async () => {
    const line = await run("cite", "Insert a citation from your library");
    await expect(slashMenu(page)).toContainText("Type to search your library");
    await expectPopupSane(slashMenu(page), line, "cite menu");
    await page.keyboard.type("zzzz");
    // The test account has no references, so the search comes back empty.
    await expect(slashMenu(page)).toContainText('No citations found for "zzzz"');
    await expectPopupSane(slashMenu(page), line, "cite menu, searched");
    await screenshot(page, "features-cite-menu");
    await page.keyboard.press("Escape");
    await expectNothingLeftBehind(page);
  });

  await test.step("Link", async () => {
    const line = await run("link", "Link to a note, reference, or paper");
    await page.keyboard.type(target.title);
    await expect(slashMenu(page).getByRole("button", { name: target.title })).toBeVisible();
    await expectPopupSane(slashMenu(page), line, "link menu");
    await screenshot(page, "features-link-menu");
    await page.keyboard.press("Enter");
    await expect(editor(page).locator('[data-type="wiki-link"]')).toContainText(target.title);
    await expectNothingLeftBehind(page);
  });

  await test.step("Agent", async () => {
    const line = await run("agent", "Run an AI agent on this note");
    await expect(slashMenu(page)).not.toContainText("Loading agents");
    await expectPopupSane(slashMenu(page), line, "agent menu");
    await screenshot(page, "features-agent-menu");
    await page.keyboard.press("Escape");
    await expectNothingLeftBehind(page);
  });

  await test.step("Code Block", async () => {
    await run("code", "Insert a code block with syntax highlighting");
    await expect(editor(page).locator("pre")).toHaveCount(1);
    await page.keyboard.type("const answer = 42;");
    await expect(editor(page).locator("pre")).toHaveText("const answer = 42;");
  });

  await test.step("Table", async () => {
    await run("table", "Insert a 3×3 table");
    await expect(editor(page).locator("table tr")).toHaveCount(3);
    await expect(editor(page).locator("table tr").first().locator("th")).toHaveCount(3);
  });

  await expectNoHorizontalOverflow(page);
});

test("bold, italic and link from the selection toolbar", async ({ page, request }) => {
  await openNoteInPanel(page, request, paper, note, "Make these three words stand out.\n\nA last line");
  const first = editor(page).locator("p").first();

  const select = async (word: string) => {
    const at = await pointOfText(first, word);
    await page.mouse.dblclick(at.x, at.y);
    const selection = await selectionRect(page);
    await expectPopupSane(selectionToolbar(page), selection, `selection toolbar over "${word}"`);
    return selection;
  };

  await select("these");
  await selectionToolbar(page).locator("button").nth(0).click();
  await expect(first.locator("strong")).toHaveText("these");

  await select("three");
  await selectionToolbar(page).locator("button").nth(1).click();
  await expect(first.locator("em")).toHaveText("three");

  const selection = await select("words");
  await selectionToolbar(page).getByRole("button", { name: "Insert link" }).click();
  await expectPopupSane(linkPopover(page), selection, "link popover");
  await linkPopover(page).getByLabel("URL").fill("example.com");
  await page.keyboard.press("Enter");
  const link = first.locator('a[href="https://example.com"]');
  await expect(link).toHaveText("words");
  await expect(linkPopover(page)).toHaveCount(0);

  await test.step("the link's edit bubble", async () => {
    // The caret is right after the new link, which already shows its bubble;
    // one step left puts the caret inside.
    await page.keyboard.press("ArrowLeft");
    await expectPopupSane(linkBubble(page), await rectOf(link), "link edit bubble");
    await linkBubble(page).getByTestId("link-edit-button").click();
    await expectPopupSane(linkEditForm(page), await rectOf(link), "link edit form");
    await screenshot(page, "features-link-edit-form");
    await expect(linkEditForm(page).getByLabel("URL")).toHaveValue("https://example.com");
    await page.keyboard.press("Escape");
    await expect(linkEditForm(page)).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
    await caretToEndOf(editor(page).locator("p").last());
    await expectNothingLeftBehind(page);
  });
});

test("a wiki link is a pill, and a click opens it in a background tab", async ({ page, request }) => {
  await openNoteInPanel(page, request, paper, note, `See [[${target.title}]] for the rest.`);
  const pill = editor(page).locator('[data-type="wiki-link"]');
  await expect(pill).toContainText(target.title);
  await expect(pill).toHaveAttribute("data-resolved", "true");
  // The pill is cut short with an ellipsis instead of pushing the panel wide.
  await expectNoHorizontalOverflow(page);
  await screenshot(page, "features-wiki-link-pill");

  const tab = page.locator(`[data-testid="tab-bar-tab"][data-href="/n/${target.slug}"]`);
  await expect(tab).toHaveCount(0);
  await pill.click();
  await expect(tab).toBeVisible();
  await expect(tab).toHaveAttribute("aria-selected", "false");
  // The reader stays on the paper, with the note still in its panel.
  expect(new URL(page.url()).pathname).toBe(`/papers/${paper.id}/read`);
  await expect(pdf(page).locator("canvas").first()).toBeVisible();
  await expect(pill).toBeVisible();
});

/** Insert a table from the slash menu and widen its first column well past the panel. */
async function insertWideTable(page: Page) {
  const root = editor(page);
  await caretToEndOf(root.locator("p").last());
  await page.keyboard.press("Enter");
  await page.keyboard.type("/table");
  await expect(slashMenu(page)).toContainText("Insert a 3×3 table");
  await page.keyboard.press("Enter");
  const edge = await rectOf(root.locator("th").first());
  const y = (edge.top + edge.bottom) / 2;
  await page.mouse.move(edge.right - 1, y);
  await page.mouse.down();
  await page.mouse.move(edge.right + 500, y, { steps: 20 });
  await page.mouse.up();
}

test("a table wider than the panel scrolls inside its own box", async ({ page, request }) => {
  await openNoteInPanel(page, request, paper, note, "A table follows.");
  await insertWideTable(page);

  const wrapper = editor(page).locator(".tableWrapper");
  const state = await wrapper.evaluate(sideways);
  expect(state.overflow, "the table is wider than its box").toBeGreaterThan(100);
  expect(state.scrolls, "the table's box scrolls").toBe(true);
  await expectNoHorizontalOverflow(page);

  await editor(page).locator("td").first().click();
  await expectPopupSane(tableMenu(page), await rectOf(wrapper), "table menu over a wide table");
  await screenshot(page, "features-wide-table");

  // The far end of the table can be reached by scrolling its box.
  await wrapper.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect(editor(page).locator("th").last()).toBeInViewport();
  await expectNoHorizontalOverflow(page);
});

test("a long code line scrolls inside its own box", async ({ page, request }) => {
  const line = `const sentence = [${Array.from({ length: 30 }, (_, i) => `"word${i}"`).join(", ")}].join(" ");`;
  await openNoteInPanel(page, request, paper, note, `Code follows.\n\n\`\`\`ts\n${line}\n\`\`\`\n\nA last line`);

  const pre = editor(page).locator("pre");
  await expect(pre).toContainText("word29");
  const state = await pre.evaluate(sideways);
  expect(state.overflow, "the line is longer than the block").toBeGreaterThan(100);
  expect(state.scrolls, "the block scrolls").toBe(true);
  const [block, body] = [await rectOf(pre), await rectOf(panelBody(page))];
  expect(block.right, "the block ends inside the panel").toBeLessThanOrEqual(body.right);
  await expectNoHorizontalOverflow(page);
  await screenshot(page, "features-long-code-line");
});

test("LaTeX renders, and a wide formula scrolls inside its own box", async ({ page, request }) => {
  // `$$` renders in KaTeX's inline mode, which breaks a long sum at its `+`
  // signs; a fraction cannot break, so this one has to scroll.
  const wide = `\\frac{${Array.from({ length: 40 }, (_, i) => `a_{${i + 1}}`).join(" + ")}}{2}`;
  const md = [
    "Inline $E = mc^2$ sits in a sentence.",
    // No `\,`: markdown reads it as an escaped comma and drops the backslash.
    "$$\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$$",
    `$$${wide}$$`,
  ].join("\n\n");
  await openNoteInPanel(page, request, paper, note, md);

  const formulas = editor(page).locator(".Tiptap-mathematics-render");
  await expect(formulas).toHaveCount(3);
  for (const formula of await formulas.all()) {
    await expect(formula.locator(".katex")).toBeVisible();
    await expect(formula.locator(".katex-error")).toHaveCount(0);
  }
  // Rendered math, not its source. The source stays in the DOM, hidden.
  await expect(editor(page).locator(".Tiptap-mathematics-editor:not(.Tiptap-mathematics-editor--hidden)")).toHaveCount(0);

  const state = await editor(page).locator("p").nth(2).evaluate(sideways);
  expect(state.overflow, "the formula is wider than its paragraph").toBeGreaterThan(100);
  expect(state.scrolls, "the paragraph scrolls").toBe(true);
  await expectNoHorizontalOverflow(page);
  await screenshot(page, "features-latex");
});
