import { test, expect } from "@playwright/test";

test.describe("Landing page", () => {
  test("renders inhale branding and Explore Papers button", async ({ page }) => {
    await page.goto("/");

    // Brand name appears at least once (nav + footer)
    await expect(page.getByText("inhale").first()).toBeVisible();

    // CTA button is present
    await expect(
      page.getByRole("link", { name: /explore papers/i })
    ).toBeVisible();
  });

  test("Explore Papers button navigates to /login", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: /explore papers/i }).click();

    await expect(page).toHaveURL(/\/login/);
  });

  test("Library nav link navigates to /login when unauthenticated", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("link", { name: /library/i }).click();

    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Route protection (unauthenticated)", () => {
  test("visiting /library redirects to /login", async ({ page }) => {
    await page.goto("/library");

    await expect(page).toHaveURL(/\/login/);
  });

  test("visiting /settings redirects to /login", async ({ page }) => {
    await page.goto("/settings");

    await expect(page).toHaveURL(/\/login/);
  });

  test("visiting /settings/api-keys redirects to /login", async ({ page }) => {
    await page.goto("/settings/api-keys");

    await expect(page).toHaveURL(/\/login/);
  });
});
