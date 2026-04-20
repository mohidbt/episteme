import { test, expect, Page } from "@playwright/test";
import { uniqueEmail, signUp, logIn, signUpAndLogin } from "./helpers/auth";

async function logOutViaMenu(page: Page) {
  await page.getByRole("button", { name: /sign out/i }).click();
  await page.waitForURL(/\/(login|$)/);
}

const errorLocator = (page: Page) =>
  page.locator(
    "[role=alert], .error, [data-error], [aria-live], form [class*=error], form [class*=Error]"
  );

test.describe("Sign up", () => {
  test("new email/password redirects to /library", async ({ page }) => {
    await signUp(page, uniqueEmail(), "Password123!");
    await expect(page).toHaveURL(/\/library/);
  });

  test("visiting /login while already authenticated redirects to /library", async ({
    page,
  }) => {
    await signUpAndLogin(page);
    await page.goto("/login");
    await page.waitForURL(/\/library/);
    await expect(page).toHaveURL(/\/library/);
  });
});

test.describe("Logout", () => {
  test("logout via user menu redirects to / or /login", async ({ page }) => {
    await signUpAndLogin(page);
    await logOutViaMenu(page);
    const url = page.url();
    expect(url.endsWith("/") || url.includes("/login")).toBeTruthy();
  });
});

test.describe("Login", () => {
  test("valid credentials redirect to /library", async ({ page }) => {
    const email = uniqueEmail();
    const password = "Password123!";
    await signUp(page, email, password);
    await logOutViaMenu(page);
    await logIn(page, email, password);
    await expect(page).toHaveURL(/\/library/);
  });

  test("wrong password shows an error message", async ({ page }) => {
    const email = uniqueEmail();
    await signUp(page, email, "Password123!");
    await logOutViaMenu(page);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("WrongPassword!");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(errorLocator(page).first()).toBeVisible({ timeout: 5000 });
  });

  test("unregistered email shows an error message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(uniqueEmail());
    await page.getByLabel("Password").fill("Password123!");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(errorLocator(page).first()).toBeVisible({ timeout: 5000 });
  });
});
