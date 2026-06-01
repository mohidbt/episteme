/**
 * Playwright recording driver for guest-tour `.webm` scenes.
 *
 * Usage:
 *   pnpm record-tour <scene>
 *
 * Where <scene> resolves to ./scenes/<scene>.ts (default export:
 * `(page: Page) => Promise<void>`).
 *
 * Env:
 *   TOUR_RECORD_EMAIL     required
 *   TOUR_RECORD_PASSWORD  required
 *   TOUR_RECORD_BASE_URL  default https://tryepisteme.com
 *
 * Emits the resulting raw video path on stdout (final line) so callers
 * (e.g. record-and-encode.sh) can pipe it into ffmpeg.
 */
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const VIDEO_DIR = resolve(process.cwd(), ".tmp/tour-record");
const SIZE = { width: 960, height: 540 };

async function login(page: Page, baseUrl: string, email: string, password: string) {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30_000 }),
    page.getByRole("button", { name: /sign in/i }).click(),
  ]);
}

async function loadScene(scene: string): Promise<(page: Page) => Promise<void>> {
  const p = resolve(__dirname, "scenes", `${scene}.ts`);
  const mod = await import(pathToFileURL(p).href);
  if (typeof mod.default !== "function") {
    throw new Error(`scene ${scene} must export a default async function`);
  }
  return mod.default;
}

async function main() {
  const scene = process.argv[2];
  if (!scene) {
    console.error("usage: pnpm record-tour <scene>");
    process.exit(2);
  }
  const email = process.env.TOUR_RECORD_EMAIL;
  const password = process.env.TOUR_RECORD_PASSWORD;
  if (!email || !password) {
    console.error("set TOUR_RECORD_EMAIL and TOUR_RECORD_PASSWORD");
    process.exit(2);
  }
  const baseUrl = process.env.TOUR_RECORD_BASE_URL ?? "https://tryepisteme.com";

  mkdirSync(VIDEO_DIR, { recursive: true });

  const runScene = await loadScene(scene);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir: VIDEO_DIR, size: SIZE },
  });
  const page = await context.newPage();

  let videoPath: string | undefined;
  try {
    await login(page, baseUrl, email, password);
    await runScene(page);
    videoPath = await page.video()?.path();
  } finally {
    await context.close(); // flushes video
    await browser.close();
  }

  if (!videoPath) {
    console.error("no video produced");
    process.exit(1);
  }
  // final stdout line = video path (consumed by record-and-encode.sh)
  process.stdout.write(`${videoPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
