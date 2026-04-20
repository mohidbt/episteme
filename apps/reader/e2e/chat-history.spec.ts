import { test, expect } from "@playwright/test";
import { signUpAndLogin } from "./helpers/auth";
import * as fs from "fs";
import * as path from "path";

const pdfPath = path.join(__dirname, "fixtures/test.pdf");

async function uploadTestPdf(page: Parameters<typeof signUpAndLogin>[0]) {
  const pdfBuffer = fs.readFileSync(pdfPath);
  const response = await page.request.post("/api/documents/upload", {
    multipart: {
      file: { name: "test.pdf", mimeType: "application/pdf", buffer: pdfBuffer },
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  return body.document as { id: number };
}

test("chat history drawer lists conversations and loads messages", async ({ page }) => {
  await signUpAndLogin(page);
  const { id: docId } = await uploadTestPdf(page);

  await page.route(`**/api/documents/${docId}/conversations`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversations: [
          {
            id: 101,
            title: "What is the main finding?",
            createdAt: new Date("2026-04-10T10:00:00Z").toISOString(),
            updatedAt: new Date("2026-04-10T10:00:00Z").toISOString(),
          },
          {
            id: 102,
            title: null,
            createdAt: new Date("2026-04-11T10:00:00Z").toISOString(),
            updatedAt: new Date("2026-04-11T10:00:00Z").toISOString(),
          },
        ],
      }),
    });
  });

  await page.route("**/api/conversations/101/messages", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { id: 1, role: "user", content: "What is the main finding?", createdAt: "2026-04-10T10:00:00Z" },
          { id: 2, role: "assistant", content: "The main finding is X.", createdAt: "2026-04-10T10:00:01Z" },
        ],
      }),
    });
  });

  await page.goto(`/reader/${docId}`);
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Chat" }).click();
  await expect(page.getByText("AI Assistant")).toBeVisible();

  await page.getByRole("button", { name: "Conversation history" }).click();
  await expect(page.getByText("What is the main finding?")).toBeVisible();
  await expect(page.getByText("Conversation #102")).toBeVisible();

  await page.getByText("What is the main finding?").first().click();
  await expect(page.getByText("The main finding is X.")).toBeVisible();
});

test("New conversation resets the thread", async ({ page }) => {
  // Per §0 of phase 2.0.2 fixes: do NOT mock /chat. Hit the real
  // endpoint with INHALE_STUB_EMBEDDINGS=1 (set in playwright.config.ts).
  test.setTimeout(120_000);
  await signUpAndLogin(page);
  const { id: docId } = await uploadTestPdf(page);

  await page.goto(`/reader/${docId}`);
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Chat" }).click();
  const chatInput = page.getByPlaceholder("Ask about this paper...");
  await expect(chatInput).toBeVisible();
  await chatInput.fill("Hi");
  await page.getByRole("button", { name: "Send" }).click();

  // Wait for the user message to render in the thread (DOM outcome —
  // confirms the request was issued and the thread is non-empty).
  await expect(page.getByText("Hi", { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "New conversation" }).click();

  // The outgoing user turn is gone and the empty-state copy returns.
  await expect(page.getByText("Ask a question about this paper")).toBeVisible();
  await expect(page.getByText("Hi", { exact: true })).toHaveCount(0);
});
