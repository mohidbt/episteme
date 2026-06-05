/**
 * Playwright recording driver for guest-tour `.webm` scenes.
 *
 * Two-phase login so the recording video contains NO login frames:
 *   1. Non-recording context → login → write storageState JSON.
 *   2. Recording context loads storageState → scene starts already authed.
 *
 * Force re-login by setting TOUR_RECORD_REAUTH=1.
 *
 * Usage:
 *   pnpm record-tour <scene>
 *
 * Env:
 *   TOUR_RECORD_EMAIL     required
 *   TOUR_RECORD_PASSWORD  required
 *   TOUR_RECORD_BASE_URL  default https://tryepisteme.com
 *   TOUR_RECORD_REAUTH    set to "1" to ignore cached storageState
 *
 * Emits the resulting raw video path on stdout (final line) so callers
 * (e.g. record-and-encode.sh) can pipe it into ffmpeg.
 */
import { chromium, type Browser, type Page } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const VIDEO_DIR = resolve(process.cwd(), ".tmp/tour-record");
const STORAGE_STATE = resolve(process.cwd(), ".tmp/tour-record/storage-state.json");
const SIZE = { width: 1440, height: 900 };

async function login(page: Page, baseUrl: string, email: string, password: string) {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30_000 }),
    page.getByRole("button", { name: /sign in/i }).click(),
  ]);
}

async function ensureStorageState(
  browser: Browser,
  baseUrl: string,
  email: string,
  password: string,
) {
  const reauth = process.env.TOUR_RECORD_REAUTH === "1";
  if (!reauth && existsSync(STORAGE_STATE)) return;
  mkdirSync(dirname(STORAGE_STATE), { recursive: true });
  const authCtx = await browser.newContext({ viewport: SIZE });
  const authPage = await authCtx.newPage();
  try {
    await login(authPage, baseUrl, email, password);
    await authCtx.storageState({ path: STORAGE_STATE });
  } finally {
    await authCtx.close();
  }
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
  let videoPath: string | undefined;
  try {
    // Phase 1: ensure cached storage state (no video).
    await ensureStorageState(browser, baseUrl, email, password);

    // Phase 2: recording context loads storageState — no login in video.
    const context = await browser.newContext({
      viewport: SIZE,
      recordVideo: { dir: VIDEO_DIR, size: SIZE },
      storageState: STORAGE_STATE,
    });
    const page = await context.newPage();
    try {
      await runScene(page);
      videoPath = await page.video()?.path();
    } finally {
      await context.close(); // flushes video
    }
  } finally {
    await browser.close();
  }

  if (!videoPath) {
    console.error("no video produced");
    process.exit(1);
  }
  process.stdout.write(`${videoPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
