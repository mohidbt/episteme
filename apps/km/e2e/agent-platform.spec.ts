import { test, expect } from "@playwright/test";

test.describe("agent platform web_search verification", () => {
  test("web_search toggle is visible in agent settings", async ({ page }) => {
    test.skip(!process.env.E2E_AUTH_READY, "Requires authenticated E2E session");
    await page.goto("/settings/agents");
    await page.getByTestId("perm-section-permissions").click();
    await expect(page.getByRole("switch", { name: /web search/i })).toBeVisible();
  });

  test("enabling web_search is included in invoke payload", async ({ page }) => {
    test.skip(!process.env.E2E_AUTH_READY, "Requires authenticated E2E session");

    await page.goto("/settings/agents");
    await page.getByTestId("perm-section-permissions").click();
    const toggle = page.getByRole("switch", { name: /web search/i });
    await expect(toggle).toBeVisible();
    if ((await toggle.getAttribute("aria-checked")) !== "true") {
      await toggle.click();
      await page.getByRole("button", { name: /^save$/i }).click();
    }

    await page.goto("/agents");
    const invokePromise = page.waitForRequest(
      (req) =>
        req.url().includes("/api/agents/km/invoke") &&
        req.method() === "POST" &&
        (req.postData() ?? "").includes("\"permissions\":{\"web_search\":true}"),
    );
    await page.getByPlaceholder(/ask|message/i).fill("Find me recent papers on attention");
    await page.keyboard.press("Enter");
    await invokePromise;
  });
});
