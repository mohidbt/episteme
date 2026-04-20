// @vitest-environment node
import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";
import { extractAnnotationMarkers } from "../annotation-extractor";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// The fixture is a real Nature Physics paper with 99 internal link annotations.
// We mock getFile so the extractor reads from disk without needing storage infra.

const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../../../e2e/fixtures/test_real_paper.pdf"
);

// Mock @/lib/storage so extractAnnotationMarkers can run without cloud storage.
// vitest resolves module aliases via vitest.config.ts alias: "@" → "src/"
// We patch the module before importing the extractor by using vi.mock hoisting.
// Since annotation-extractor imports getFile at module-load time, we use
// a manual factory mock.

import { vi } from "vitest";

vi.mock("@/lib/storage", () => ({
  getFile: async (_filePath: string): Promise<Buffer> => {
    return fs.readFileSync(FIXTURE_PATH);
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extractAnnotationMarkers (Nature Physics fixture)", () => {
  it("returns at least one marker from the fixture PDF", async () => {
    const result = await extractAnnotationMarkers("any/path.pdf");
    expect(result.markers.length).toBeGreaterThan(0);
  }, 30_000);

  it("at least one marker has a resolvable markerIndex mapping to a parsed reference", async () => {
    const result = await extractAnnotationMarkers("any/path.pdf");

    // Every marker should have a corresponding reference
    const refIndexSet = new Set(result.references.map((r) => r.markerIndex));
    const markerWithRef = result.markers.find((m) => refIndexSet.has(m.markerIndex));
    expect(markerWithRef).toBeDefined();

    // That reference should have a rawText (it was parsed)
    const ref = result.references.find((r) => r.markerIndex === markerWithRef!.markerIndex);
    expect(ref).toBeDefined();
    expect(ref!.rawText.length).toBeGreaterThan(0);
  }, 30_000);

  it("no markers have zero-sized rects", async () => {
    const result = await extractAnnotationMarkers("any/path.pdf");
    for (const m of result.markers) {
      const isZeroSized = m.x0 === m.x1 && m.y0 === m.y1;
      expect(isZeroSized).toBe(false);
    }
  }, 30_000);

  it("all referenced markerIndexes are in range 1-999", async () => {
    const result = await extractAnnotationMarkers("any/path.pdf");
    for (const ref of result.references) {
      expect(ref.markerIndex).toBeGreaterThanOrEqual(1);
      expect(ref.markerIndex).toBeLessThanOrEqual(999);
    }
    for (const m of result.markers) {
      expect(m.markerIndex).toBeGreaterThanOrEqual(1);
      expect(m.markerIndex).toBeLessThanOrEqual(999);
    }
  }, 30_000);

  it("markers have valid page numbers (>= 1)", async () => {
    const result = await extractAnnotationMarkers("any/path.pdf");
    for (const m of result.markers) {
      expect(m.pageNumber).toBeGreaterThanOrEqual(1);
    }
  }, 30_000);

  it("references are deduplicated: unique markerIndexes", async () => {
    const result = await extractAnnotationMarkers("any/path.pdf");
    const idxs = result.references.map((r) => r.markerIndex);
    const uniqueIdxs = [...new Set(idxs)];
    expect(idxs.length).toBe(uniqueIdxs.length);
  }, 30_000);
});
