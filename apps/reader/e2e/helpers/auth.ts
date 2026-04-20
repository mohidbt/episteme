import { Page } from "@playwright/test";

let emailCounter = Date.now();

export function uniqueEmail() {
  return `test_${emailCounter++}@inhale.test`;
}

export async function signUp(page: Page, email: string, password: string) {
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Test User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/library");
}

export async function logIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/library");
}

export async function signUpAndLogin(page: Page) {
  const email = uniqueEmail();
  const password = "Password123!";
  await signUp(page, email, password);
  return { email, password };
}
