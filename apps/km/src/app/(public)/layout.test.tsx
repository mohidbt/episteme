// @vitest-environment jsdom
// GSD-151: the public route group gets a slim layout — no MobileGate, no
// Sentry feedback widget, no auth-gated providers — so /landing can be
// statically prerendered and the app chrome no longer leaks onto marketing.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, cleanup } from "@testing-library/react";
import PublicLayout from "./layout";

afterEach(() => cleanup());

const layoutSource = readFileSync(
  path.join(process.cwd(), "src/app/(public)/layout.tsx"),
  "utf8",
);

describe("(public) layout", () => {
  it("renders its children", () => {
    render(<PublicLayout>{<div data-testid="child">hi</div>}</PublicLayout>);
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("does not pull in the desktop MobileGate", () => {
    expect(layoutSource).not.toContain("MobileGate");
  });

  it("does not read request-time headers() (keeps the route statically prerenderable)", () => {
    expect(layoutSource).not.toContain("headers(");
  });

  it("does not mount the Sentry feedback / app-chrome providers", () => {
    expect(layoutSource).not.toContain("Sentry");
    expect(layoutSource).not.toContain("AgentBall");
    expect(layoutSource).not.toContain("Sidebar");
  });
});
