import { test, expect } from "@playwright/test";
import { signUpAndLogin } from "./helpers/auth";
import * as fs from "fs";
import * as path from "path";

const pdfPath = path.join(__dirname, "fixtures/test.pdf");

interface TestDocument {
  id: number;
  processingStatus: string;
}

async function uploadTestPdf(
  page: Parameters<typeof signUpAndLogin>[0]
): Promise<TestDocument> {
  const pdfBuffer = fs.readFileSync(pdfPath);
  const response = await page.request.post("/api/documents/upload", {
    multipart: {
      file: {
        name: "test.pdf",
        mimeType: "application/pdf",
        buffer: pdfBuffer,
      },
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  return body.document as TestDocument;
}

test("upload sets processingStatus to ready or failed", async ({ page }) => {
  await signUpAndLogin(page);
  const doc = await uploadTestPdf(page);

  expect(typeof doc.id).toBe("number");
  expect(doc.id).toBeGreaterThan(0);
  expect(doc.processingStatus).toBe("ready");
});

test("outline sidebar shows Pages tab with per-page navigation", async ({ page }) => {
  await signUpAndLogin(page);
  const { id: docId } = await uploadTestPdf(page);

  await page.goto(`/reader/${docId}`);
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Outline" }).click();
  const outlineSidebar = page.getByTestId("outline-sidebar");
  await expect(outlineSidebar.getByRole("tab", { name: "Pages" })).toBeVisible();
  await expect(outlineSidebar.getByRole("button", { name: "Page 1" })).toBeVisible();
});

// NOTE: The mocked-SSE chat test was removed in 2026-04-14.
// Real-backend chat coverage lives in `chat-context.spec.ts` (Issue 5):
// it asserts the outbound /chat request body shape against the real
// endpoint with `INHALE_STUB_EMBEDDINGS=1` and observes a streamed
// assistant response without mocking. Per §0 of phase 2.0.2 fixes,
// we never mock the endpoint under test.
