// @vitest-environment node
// #53 — Drive list/tile switcher pill is reused in /settings/agents.
// Both surfaces must import from this shared component.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("PillSwitcher reuse (#53)", () => {
  it("FileBrowserToolbar imports PillSwitcher", () => {
    const src = read("src/components/FileBrowserToolbar.tsx");
    expect(src).toMatch(/from\s+["']@\/components\/ui\/PillSwitcher["']/);
  });

  it("FileBrowserToolbar does not render the Drive folder pill with PathPill", () => {
    const src = read("src/components/FileBrowserToolbar.tsx");
    expect(src).not.toMatch(/from\s+["']@\/components\/PathPill["']/);
  });

  it("PermissionsForm imports PillSwitcher", () => {
    const src = read("src/components/settings/PermissionsForm.tsx");
    expect(src).toMatch(/from\s+["']@\/components\/ui\/PillSwitcher["']/);
  });

  it("PillSwitcher exports a PillSwitcher component", () => {
    const src = read("src/components/ui/PillSwitcher.tsx");
    expect(src).toMatch(/export\s+(function|const)\s+PillSwitcher/);
  });
});
