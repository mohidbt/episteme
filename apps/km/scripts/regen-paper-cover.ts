/**
 * GSD-50 tour-record helper: regenerate the cover PNG for a single paper.
 *
 * Test-account demo papers were uploaded before the cover-extraction backfill
 * existed, so paper cards in the guest-tour app show the ugly placeholder.
 * This script downloads the source PDF from S3/R2, runs the same
 * `extractCover` used by the /finalize route, and re-uploads the PNG to
 * `paperCoverKey(id)`.
 *
 * Usage:
 *   pnpm tsx scripts/regen-paper-cover.ts <paperId>
 *
 * Env: same S3_* vars the runtime uses (see src/lib/storage.ts).
 */
import { storage, paperSourceKey, paperCoverKey } from "@/lib/storage";
import { extractCover } from "@/lib/pdf-extract";

async function main() {
  const paperId = process.argv[2];
  if (!paperId) {
    console.error("usage: tsx scripts/regen-paper-cover.ts <paperId>");
    process.exit(2);
  }

  const getUrl = await storage.getPresignedGet(paperSourceKey(paperId), 120);
  const res = await fetch(getUrl);
  if (!res.ok) {
    console.error(`source fetch failed: ${res.status}`);
    process.exit(1);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  console.log(`downloaded source: ${bytes.byteLength} bytes`);

  const cover = await extractCover(bytes);
  console.log(`extracted cover: ${cover.byteLength} bytes`);

  await storage.uploadObject(paperCoverKey(paperId), cover, "image/png");
  console.log(`uploaded cover to ${paperCoverKey(paperId)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
