import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

/**
 * Spec-presence guard for Phase 2.0.2 fixes (2026-04-14).
 *
 * Each of the six issues fixed in phase 2.0.2 ships with a dedicated
 * end-to-end spec that exercises the real backend (no mocking the
 * endpoint under test, real PDF fixture). If any of these spec files
 * disappears or is renamed without updating this list, CI fails — this
 * is a deliberate smoke check to keep coverage from silently regressing.
 *
 * If you intentionally remove or rename one of these specs, update this
 * list AND document the replacement coverage in the same PR.
 */

const REQUIRED_SPECS = [
  "highlights-render.spec.ts", // Issue 1: userHighlights lift
  "outline-thumbnails.spec.ts", // Issue 2: outline thumbnails
  "find-search.spec.ts", // Issue 3: DOM Cmd+F
  "comment-flow.spec.ts", // Issue 4: persistent comment popup + Comments tab
  "chat-context.spec.ts", // Issue 5: scope-aware chat context
  "dock.spec.ts", // Issue 6: docking via react-resizable-panels
];

test("required phase 2.0.2 spec files are present", () => {
  const e2eDir = path.resolve(__dirname, "..");
  const missing: string[] = [];
  for (const spec of REQUIRED_SPECS) {
    const full = path.join(e2eDir, spec);
    if (!fs.existsSync(full)) {
      missing.push(spec);
    }
  }
  expect(
    missing,
    `Missing required phase 2.0.2 spec files: ${missing.join(", ")}.\n` +
      `If you removed a spec on purpose, update e2e/__meta__/required-specs.spec.ts ` +
      `and document the replacement coverage in your PR.`
  ).toEqual([]);
});

test("required phase 2.0.2 specs contain at least one test()", () => {
  // A trivially-empty spec would defeat the presence check, so
  // also assert each file actually defines a test.
  const e2eDir = path.resolve(__dirname, "..");
  const empty: string[] = [];
  for (const spec of REQUIRED_SPECS) {
    const full = path.join(e2eDir, spec);
    if (!fs.existsSync(full)) continue; // covered by the test above
    const src = fs.readFileSync(full, "utf8");
    if (!/\btest\s*\(/.test(src)) {
      empty.push(spec);
    }
  }
  expect(
    empty,
    `These spec files exist but contain no test() calls: ${empty.join(", ")}`
  ).toEqual([]);
});
