// TODO(phase-0.11): This spec is a stub — no Playwright harness is wired up
// in apps/km yet. When the e2e harness lands, flip `test.skip` to `test` and
// implement the scenario below. Until then, the equivalent coverage lives in
// src/components/VersionDrawer.test.tsx (UI + fetch mocks) plus manual QA.
//
// Scenario:
//   1. Open an existing note page, edit the content twice (triggering two
//      autosave revisions).
//   2. Click the Versions button in the page header -> drawer opens, shows
//      at least 2 revisions.
//   3. Click the oldest revision -> diff view renders with both red
//      (removed) and green (added) spans.
//   4. Click Restore, confirm the dialog -> editor content reverts to the
//      oldest revision's markdown.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const test: {
  skip: (name: string, fn: () => Promise<void> | void) => void;
};

// When a Playwright harness is introduced, replace this with:
//   import { test, expect } from "@playwright/test";
test.skip("restoring an older revision reverts editor content", async () => {
  // pending — see TODO above.
});
