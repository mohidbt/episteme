import { test, expect } from "@playwright/test";
import { signUpAndLogin } from "./helpers/auth";

test.describe("Settings", () => {
  test.beforeEach(async ({ page }) => {
    await signUpAndLogin(page);
  });

  test("navigating to /settings redirects to /settings/api-keys", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForURL("**/settings/api-keys");
    await expect(page).toHaveURL(/\/settings\/api-keys/);
  });

  test("settings/api-keys page renders with API Keys heading when authenticated", async ({ page }) => {
    await page.goto("/settings/api-keys");
    await expect(page.getByRole("heading", { name: "API Keys", level: 1 })).toBeVisible();
  });

  test("add API key form is visible with correct fields", async ({ page }) => {
    await page.goto("/settings/api-keys");

    await expect(page.getByRole("heading", { name: "Add API Key" })).toBeVisible();
    await expect(page.getByLabel("Provider Type")).toBeVisible();
    await expect(page.getByLabel("Provider Name")).toBeVisible();
    await expect(page.getByLabel("API Key")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save Key" })).toBeVisible();
  });

  test("provider type select has expected options", async ({ page }) => {
    await page.goto("/settings/api-keys");

    const select = page.locator("#providerType");
    await expect(select).toBeVisible();
    await expect(select.locator("option[value='llm']")).toHaveText("LLM");
    await expect(select.locator("option[value='voice']")).toHaveText("Voice");
    await expect(select.locator("option[value='ocr']")).toHaveText("OCR");
  });

  test("selecting provider type auto-fills provider name", async ({ page }) => {
    await page.goto("/settings/api-keys");

    const select = page.locator("#providerType");
    const providerNameInput = page.getByLabel("Provider Name");

    // Default: llm -> openrouter
    await expect(providerNameInput).toHaveValue("openrouter");

    // Switch to voice -> elevenlabs
    await select.selectOption("voice");
    await expect(providerNameInput).toHaveValue("elevenlabs");

    // Switch to ocr -> mistral
    await select.selectOption("ocr");
    await expect(providerNameInput).toHaveValue("mistral");
  });

  test("add an API key and it appears in the saved keys list", async ({ page }) => {
    await page.goto("/settings/api-keys");

    // Fill in the form
    await page.locator("#providerType").selectOption("llm");
    await expect(page.getByLabel("Provider Name")).toHaveValue("openrouter");
    await page.getByLabel("API Key").fill("sk-test-key-1234567890abcdef");

    // Submit
    await page.getByRole("button", { name: "Save Key" }).click();

    // Wait for the key to appear in the saved list
    await expect(page.getByRole("heading", { name: "Saved Keys" })).toBeVisible();
    await expect(page.getByText("openrouter")).toBeVisible();
  });

  test("saved API key is masked — full key value is not displayed", async ({ page }) => {
    const fullKey = "sk-test-supersecretkey9999";
    await page.goto("/settings/api-keys");

    await page.locator("#providerType").selectOption("llm");
    await page.getByLabel("API Key").fill(fullKey);
    await page.getByRole("button", { name: "Save Key" }).click();

    // Wait for the key row to appear
    await expect(page.getByText("openrouter")).toBeVisible();

    // The full key must not be present anywhere in the page text
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain(fullKey);

    // The preview should be present and look like a masked/truncated value (e.g. "sk-t...cdef")
    // We verify that the key row contains something that is NOT the full key
    const keyPreview = page.locator(".font-mono").first();
    await expect(keyPreview).toBeVisible();
    const previewText = await keyPreview.innerText();
    expect(previewText).not.toBe(fullKey);
    expect(previewText.length).toBeLessThan(fullKey.length);
  });

  test("delete an API key — it disappears from the list", async ({ page }) => {
    await page.goto("/settings/api-keys");

    // Add a key first
    await page.locator("#providerType").selectOption("ocr");
    await expect(page.getByLabel("Provider Name")).toHaveValue("mistral");
    await page.getByLabel("API Key").fill("ocr-key-deletetest-xyz");
    await page.getByRole("button", { name: "Save Key" }).click();

    // Wait for the row to appear
    await expect(page.getByText("mistral")).toBeVisible();

    // Click Remove — only one key exists at this point so it's unambiguous
    await page.getByRole("button", { name: "Remove" }).click();

    // The row should disappear
    await expect(page.getByText("mistral")).not.toBeVisible();
  });

  test("empty state message shown when no keys are saved", async ({ page }) => {
    await page.goto("/settings/api-keys");

    // For a fresh user there are no keys yet
    await expect(page.getByText("No API keys saved yet.")).toBeVisible();
  });

  test("add and then delete multiple keys independently", async ({ page }) => {
    await page.goto("/settings/api-keys");

    // Add LLM key
    await page.locator("#providerType").selectOption("llm");
    await page.getByLabel("API Key").fill("llm-key-aaa111");
    await page.getByRole("button", { name: "Save Key" }).click();
    await expect(page.getByText("openrouter")).toBeVisible();

    // Add Voice key
    await page.locator("#providerType").selectOption("voice");
    await page.getByLabel("API Key").fill("voice-key-bbb222");
    await page.getByRole("button", { name: "Save Key" }).click();
    await expect(page.getByText("elevenlabs")).toBeVisible();

    // Keys are in insertion order: openrouter (LLM) was added first → first Remove button
    await page.getByRole("button", { name: "Remove" }).first().click();
    await expect(page.getByText("openrouter")).not.toBeVisible();
    await expect(page.getByText("elevenlabs")).toBeVisible();
  });
});
