import { test, expect, Page } from "@playwright/test";
import { signUpAndLogin } from "./helpers/auth";
import * as fs from "fs";
import * as path from "path";

const PDF_PATH = path.join(__dirname, "fixtures/test_real_paper.pdf");

async function uploadTestPdf(page: Page, filename: string): Promise<{ id: number }> {
  const pdfBuffer = fs.readFileSync(PDF_PATH);
  const response = await page.request.post("/api/documents/upload", {
    multipart: {
      file: {
        name: filename,
        mimeType: "application/pdf",
        buffer: pdfBuffer,
      },
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  return { id: body.document.id as number };
}

test("comment popup stays open after focus shift; appears in Comments tab", async ({ page }) => {
  await signUpAndLogin(page);
  const { id } = await uploadTestPdf(page, "test_real_paper.pdf");
  await page.goto(`/reader/${id}`);

  // Wait for the first page canvas to render.
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });

  // Wait for the text layer + natural-size attrs (needed for selection rects).
  await page.waitForFunction(
    () => {
      const pageEl = document.querySelector<HTMLElement>(
        '[data-page-number="1"][data-natural-width]'
      );
      if (!pageEl) return false;
      const w = Number(pageEl.getAttribute("data-natural-width"));
      if (!Number.isFinite(w) || w <= 0) return false;
      return document.querySelectorAll(".react-pdf__Page__textContent span").length > 0;
    },
    undefined,
    { timeout: 10_000 }
  );

  // Select a span well inside the viewport.
  await page.evaluate(() => {
    const spans = Array.from(
      document.querySelectorAll<HTMLElement>(".react-pdf__Page__textContent span")
    );
    const viewportH = window.innerHeight;
    const candidate =
      spans.find((s) => {
        const r = s.getBoundingClientRect();
        return r.top > 120 && r.bottom < viewportH - 40 && s.textContent?.trim();
      }) ?? spans[Math.floor(spans.length / 2)];
    if (!candidate) throw new Error("no text span");
    const r = document.createRange();
    r.selectNodeContents(candidate);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    document.dispatchEvent(new Event("selectionchange"));
  });

  // Toolbar Comment button should appear.
  const commentBtn = page.getByRole("button", { name: /^comment$/i });
  await expect(commentBtn).toBeVisible({ timeout: 5_000 });
  await commentBtn.click();

  // Textarea for the comment popup is visible.
  const textarea = page.locator('textarea[placeholder*="comment" i]');
  await expect(textarea).toBeVisible();

  // Simulate the focus / selection change that previously unmounted the
  // toolbar: programmatically clear the window selection and dispatch
  // selectionchange. The popup MUST remain visible (snapshot keeps it alive).
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
  });

  // CRITICAL assertion: the textarea must still be visible.
  await expect(textarea).toBeVisible();

  // Type a note and save.
  await textarea.fill("test note from e2e");
  await page.getByRole("button", { name: /^save$/i }).click();

  // After save the textarea closes.
  await expect(textarea).toBeHidden({ timeout: 5_000 });

  // Open Comments tab.
  await page.getByRole("button", { name: /^comments$/i }).click();

  // The comment text appears in the sidebar.
  await expect(page.getByText("test note from e2e")).toBeVisible({ timeout: 5_000 });

  // Screenshot on failure.
  if (test.info().status !== test.info().expectedStatus) {
    await page.screenshot({
      path: `e2e/__failures__/comment-flow-${Date.now()}.png`,
      fullPage: true,
    });
  }
});
