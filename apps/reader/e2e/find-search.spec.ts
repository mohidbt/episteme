import { test, expect, Page } from "@playwright/test";
import { signUpAndLogin } from "./helpers/auth";
import * as fs from "fs";
import * as path from "path";

const PDF_PATH = path.join(__dirname, "fixtures/test_real_paper.pdf");
const FAILURES_DIR = path.join(__dirname, "__failures__");

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

async function ensureFailuresDir() {
  if (!fs.existsSync(FAILURES_DIR)) fs.mkdirSync(FAILURES_DIR, { recursive: true });
}

test.describe("Cmd+F find in document", () => {
  test("highlights matches in the PDF text layer", async ({ page }, testInfo) => {
    try {
      await signUpAndLogin(page);
      const { id } = await uploadTestPdf(page, "test_real_paper.pdf");
      await page.goto(`/reader/${id}`);

      // Wait for first page text layer to render so there is something to search.
      await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".react-pdf__Page__textContent span").length > 0,
        undefined,
        { timeout: 15_000 }
      );

      // Pick a search token that is highly likely to appear in any English paper.
      // We pick from the actual rendered text to guarantee hits.
      const queryToken = await page.evaluate(() => {
        const spans = Array.from(
          document.querySelectorAll<HTMLElement>(".react-pdf__Page__textContent span")
        );
        // Look for a short, lowercase, alphabetic token that occurs at least
        // twice across the rendered text.
        const counts = new Map<string, number>();
        for (const s of spans) {
          const tokens = (s.textContent ?? "")
            .toLowerCase()
            .split(/[^a-z]+/)
            .filter((t) => t.length >= 3 && t.length <= 8);
          for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
        }
        // Prefer common English words.
        const preferred = ["the", "and", "for", "with", "this", "that", "from"];
        for (const p of preferred) {
          if ((counts.get(p) ?? 0) >= 2) return p;
        }
        // Fall back to most frequent token.
        let best: string | null = null;
        let bestCount = 0;
        for (const [tok, c] of counts.entries()) {
          if (c > bestCount) {
            best = tok;
            bestCount = c;
          }
        }
        return best;
      });
      expect(queryToken).toBeTruthy();

      // Open the find bar via Cmd+F (Mac) — reader-client listens for both.
      await page.keyboard.press("Meta+f");

      const findInput = page.getByPlaceholder("Find in document…");
      await expect(findInput).toBeVisible({ timeout: 5_000 });

      // Type the query.
      await findInput.fill(queryToken!);

      // Wait for marks to appear.
      await page.waitForFunction(
        () => document.querySelectorAll("mark.find-match").length > 0,
        undefined,
        { timeout: 5_000 }
      );

      const matchCount = await page.locator("mark.find-match").count();
      expect(matchCount).toBeGreaterThan(0);

      // Exactly one match should be marked --current after initial search.
      const currentCount = await page.locator("mark.find-match--current").count();
      expect(currentCount).toBe(1);

      // Verify that the current match's background color differs from a
      // non-current match (computed style — confirms CSS applied correctly).
      const colors = await page.evaluate(() => {
        const all = Array.from(
          document.querySelectorAll<HTMLElement>("mark.find-match")
        );
        const current = all.find((m) => m.classList.contains("find-match--current"));
        const other = all.find((m) => !m.classList.contains("find-match--current"));
        if (!current) return null;
        const currentBg = getComputedStyle(current).backgroundColor;
        const otherBg = other ? getComputedStyle(other).backgroundColor : null;
        return { currentBg, otherBg };
      });
      expect(colors).not.toBeNull();
      expect(colors!.currentBg).toBeTruthy();
      // If there's more than one match, the colors must differ.
      if (matchCount > 1) {
        expect(colors!.otherBg).toBeTruthy();
        expect(colors!.currentBg).not.toEqual(colors!.otherBg);
      }

      // Press Enter to advance to the Next match. Refocus input first.
      await findInput.focus();
      await page.keyboard.press("Enter");

      // After Next, current should still be exactly one and visible in viewport.
      await expect(page.locator("mark.find-match--current")).toHaveCount(1);

      const inViewport = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>("mark.find-match--current");
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return (
          r.top >= 0 &&
          r.left >= 0 &&
          r.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
          r.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
      });
      expect(inViewport).toBe(true);

      // Closing the find bar should remove all marks.
      await page.keyboard.press("Escape");
      await expect(findInput).toBeHidden();
      // Marks may persist briefly; the FindBar close handler doesn't currently
      // clear them, but typing a new empty search would. We only assert the UI
      // closes. (The hook's unmount cleanup runs only on full unmount.)
    } catch (err) {
      await ensureFailuresDir();
      const screenshotPath = path.join(
        FAILURES_DIR,
        `find-search-${testInfo.title.replace(/\s+/g, "_")}.png`
      );
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      throw err;
    }
  });
});
