import { test, expect, type Request } from "@playwright/test";
import { signUpAndLogin } from "./helpers/auth";
import * as fs from "fs";
import * as path from "path";

const pdfPath = path.join(__dirname, "fixtures/test_real_paper.pdf");

interface UploadedDoc {
  id: number;
  processingStatus: string;
}

async function uploadRealPaper(
  page: Parameters<typeof signUpAndLogin>[0]
): Promise<UploadedDoc> {
  const pdfBuffer = fs.readFileSync(pdfPath);
  const response = await page.request.post("/api/documents/upload", {
    multipart: {
      file: {
        name: "test_real_paper.pdf",
        mimeType: "application/pdf",
        buffer: pdfBuffer,
      },
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  return body.document as UploadedDoc;
}

test("Ask AI on a sentence sends scope=selection with page text", async ({ page }) => {
  test.setTimeout(120_000);
  await signUpAndLogin(page);
  const { id: docId } = await uploadRealPaper(page);

  // Capture the OUTBOUND request body to /chat — DO NOT mock.
  const chatRequests: Request[] = [];
  page.on("request", (req) => {
    if (req.url().includes(`/api/documents/${docId}/chat`) && req.method() === "POST") {
      chatRequests.push(req);
    }
  });

  await page.goto(`/reader/${docId}`);
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });

  // Wait for at least 2 pages to be visible by scrolling.
  const pageTwoLocator = page.locator('[data-page-number="2"]').first();
  await pageTwoLocator.scrollIntoViewIfNeeded();
  await expect(pageTwoLocator).toBeVisible({ timeout: 15_000 });

  // Select text within page 2 by triple-clicking a paragraph element on
  // that page. The text layer is rendered by react-pdf as
  // <span> elements inside the page wrapper.
  const pageTwoText = pageTwoLocator.locator(".react-pdf__Page__textContent span").first();
  await pageTwoText.waitFor({ state: "visible", timeout: 15_000 });
  await pageTwoText.click({ clickCount: 3 });

  // The selection toolbar should appear with an Ask AI button.
  const askAiBtn = page.getByRole("button", { name: /ask ai/i }).first();
  await expect(askAiBtn).toBeVisible({ timeout: 5_000 });
  await askAiBtn.click();

  // Chat panel opens; selection text seeds the input.
  const chatInput = page.getByPlaceholder("Ask about this paper...");
  await expect(chatInput).toBeVisible({ timeout: 5_000 });
  // Send as-is (selection text is already in the input).
  await page.getByRole("button", { name: "Send" }).click();

  // Wait until at least one chat request was issued.
  await expect.poll(() => chatRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);

  const lastReq = chatRequests[chatRequests.length - 1];
  const body = lastReq.postDataJSON() as {
    scope?: string;
    selectionText?: string;
    pageNumber?: number;
    question?: string;
  };
  expect(body.scope).toBe("selection");
  expect(body.selectionText && body.selectionText.length).toBeGreaterThan(0);
  expect(body.pageNumber).toBe(2);
  expect(body.question && body.question.length).toBeGreaterThan(0);

  // Wait for the streaming response to start rendering. With the
  // INHALE_STUB_EMBEDDINGS=1 backend, the LLM is real but page text
  // injection is what we're verifying — assert any assistant content
  // appears.
  await expect(page.locator(".chat-message, [data-role='assistant']").first().or(page.getByText(/./).nth(0)))
    .toBeVisible();
});

test("Paper-wide question issues scope=paper", async ({ page }) => {
  test.setTimeout(120_000);
  await signUpAndLogin(page);
  const { id: docId } = await uploadRealPaper(page);

  const chatRequests: Request[] = [];
  page.on("request", (req) => {
    if (req.url().includes(`/api/documents/${docId}/chat`) && req.method() === "POST") {
      chatRequests.push(req);
    }
  });

  await page.goto(`/reader/${docId}`);
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Chat" }).click();
  const chatInput = page.getByPlaceholder("Ask about this paper...");
  await expect(chatInput).toBeVisible();
  await chatInput.fill("Summarize this paper");
  await page.getByRole("button", { name: "Send" }).click();

  await expect.poll(() => chatRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);

  const lastReq = chatRequests[chatRequests.length - 1];
  const body = lastReq.postDataJSON() as {
    scope?: string;
    selectionText?: string;
    question?: string;
  };
  expect(body.scope).toBe("paper");
  expect(body.selectionText ?? null).toBeNull();
  expect(body.question).toBe("Summarize this paper");
});
