import path from "path";
import { test, expect } from "@playwright/test";
import { signUpAndLogin } from "./helpers/auth";

const TEST_PDF = path.resolve(__dirname, "fixtures/test.pdf");

test.describe("Library page", () => {
  test("renders heading and upload zone when authenticated", async ({
    page,
  }) => {
    await signUpAndLogin(page);

    await expect(page.getByRole("heading", { name: /library/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /drag.*drop.*pdf|click to select/i })
    ).toBeVisible();
  });

  test("fresh user sees the empty-state message", async ({ page }) => {
    await signUpAndLogin(page);

    await expect(page.getByText("No documents yet.")).toBeVisible();
    await expect(
      page.getByText("Upload a PDF above to get started.")
    ).toBeVisible();
    // No document cards (links to /reader/) should be present
    await expect(page.locator('a[href^="/reader/"]')).toHaveCount(0);
  });

  test("upload a PDF — card appears in the library", async ({ page }) => {
    await signUpAndLogin(page);

    // The file input is visually hidden; target it directly
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(TEST_PDF);

    // Wait for the upload to complete and the page to refresh with the new card
    // The card thumbnail always contains the text "PDF"
    await expect(page.locator("text=PDF").first()).toBeVisible({
      timeout: 15_000,
    });

    // Empty state should be gone
    await expect(page.getByText("No documents yet.")).not.toBeVisible();
  });

  test("uploaded document card shows the filename or title", async ({
    page,
  }) => {
    await signUpAndLogin(page);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(TEST_PDF);

    // Wait for at least one document card link to appear
    const cardLink = page.locator('a[href^="/reader/"]').first();
    await expect(cardLink).toBeVisible({ timeout: 15_000 });

    // The card body should contain some non-empty title text
    const cardText = await cardLink.innerText();
    expect(cardText.trim().length).toBeGreaterThan(0);
  });

  test("clicking a document card navigates to /reader/[id]", async ({
    page,
  }) => {
    await signUpAndLogin(page);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(TEST_PDF);

    // Wait for the card link to appear then click it
    const cardLink = page.locator('a[href^="/reader/"]').first();
    await expect(cardLink).toBeVisible({ timeout: 15_000 });
    await cardLink.click();

    await expect(page).toHaveURL(/\/reader\/\d+/, { timeout: 10_000 });
  });

  test("uploading a non-PDF file is rejected by the API", async ({ page }) => {
    await signUpAndLogin(page);

    // Test rejection at the API level — more reliable than DOM file input MIME gating
    const res = await page.request.post("/api/documents/upload", {
      multipart: {
        file: {
          name: "document.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("hello world"),
        },
      },
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/pdf/i);
  });
});
