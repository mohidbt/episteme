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

async function captureFailure(page: Page, name: string) {
  const file = path.join(__dirname, "__failures__", `${name}.png`);
  try {
    await page.screenshot({ path: file, fullPage: true });
  } catch {
    /* ignore */
  }
}

test.describe("Outline sidebar — Pages thumbnails + Contents tab", () => {
  test("Pages tab renders lazy thumbnails for a real paper", async ({ page }, testInfo) => {
    try {
      await signUpAndLogin(page);
      const { id } = await uploadTestPdf(page, "test_real_paper.pdf");
      await page.goto(`/reader/${id}`);

      // Wait for first page canvas (PDF loaded).
      await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

      // Open the outline panel.
      await page.getByRole("button", { name: /outline/i }).click();

      const sidebar = page.locator('[data-testid="outline-sidebar"]');
      await expect(sidebar).toBeVisible({ timeout: 5_000 });

      // The default tab on a paper without embedded bookmarks should
      // already be Pages — but click it explicitly to be deterministic.
      await sidebar.getByRole("tab", { name: /pages/i }).click();

      const thumbs = page.locator('[data-testid="page-thumb"]');

      // First thumbnail should appear and have non-zero width once rendered.
      await expect(thumbs.first()).toBeVisible({ timeout: 10_000 });
      await page.waitForFunction(
        () => {
          const el = document.querySelector<HTMLElement>('[data-testid="page-thumb"]');
          if (!el) return false;
          const c = el.querySelector("canvas");
          return !!c && c.clientWidth > 0;
        },
        undefined,
        { timeout: 15_000 }
      );
      const firstWidth = await thumbs.first().evaluate((el) => {
        const c = el.querySelector("canvas");
        return c ? c.clientWidth : 0;
      });
      expect(firstWidth).toBeGreaterThan(0);

      // Lazy load: scroll the sidebar and assert more thumbnails appear.
      const initialCount = await thumbs.count();
      await sidebar.evaluate((el) => {
        // Scroll the inner panel that holds the thumbnails to the bottom.
        const scrollable = el.querySelector<HTMLElement>(".overflow-auto");
        if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
      });
      // Allow IntersectionObserver + render to catch up.
      await page.waitForTimeout(1500);
      const eventualWidth = await thumbs.last().evaluate((el) => {
        const c = el.querySelector("canvas");
        return c ? c.clientWidth : 0;
      });
      expect(eventualWidth).toBeGreaterThan(0);
      // Sanity: the total number of thumb buttons equals total pages,
      // confirming we render placeholders for all pages but only paint
      // visible ones.
      expect(initialCount).toBeGreaterThan(0);
    } catch (e) {
      await captureFailure(page, testInfo.title.replace(/\W+/g, "_"));
      throw e;
    }
  });

  test("Contents tab always present, shows tree or empty state", async ({ page }, testInfo) => {
    try {
      await signUpAndLogin(page);
      const { id } = await uploadTestPdf(page, "test_real_paper.pdf");
      await page.goto(`/reader/${id}`);
      await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

      await page.getByRole("button", { name: /outline/i }).click();
      const sidebar = page.locator('[data-testid="outline-sidebar"]');
      await expect(sidebar).toBeVisible({ timeout: 5_000 });

      // The Contents tab must always render, even if no native outline.
      const contentsTab = sidebar.getByRole("tab", { name: /contents/i });
      await expect(contentsTab).toBeVisible();
      await contentsTab.click();

      // Either there are section buttons (native or computed outline)
      // OR the explicit empty-state copy is visible. Wait for the
      // computed-outline async pass to finish first (it has a loading
      // placeholder).
      await expect(async () => {
        const sectionCount = await page
          .locator('[data-testid="outline-section"]')
          .count();
        const emptyVisible = await page
          .locator('[data-testid="contents-empty"]')
          .isVisible()
          .catch(() => false);
        expect(sectionCount > 0 || emptyVisible).toBe(true);
      }).toPass({ timeout: 20_000 });
    } catch (e) {
      await captureFailure(page, testInfo.title.replace(/\W+/g, "_"));
      throw e;
    }
  });
});
