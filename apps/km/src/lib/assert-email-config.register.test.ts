import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Guards the boot wiring: register() must invoke the Resend boot assertion in
// the Node.js runtime and skip it in the Edge runtime. This catches a future
// regression where the assertion is moved out of the nodejs-only branch.

// Sentry side-effect imports are irrelevant to this test — stub them so the
// dynamic imports inside register() resolve without real initialization.
vi.mock("../../sentry.server.config", () => ({}));
vi.mock("../../sentry.edge.config", () => ({}));

const assertResendConfigured = vi.fn();
vi.mock("./assert-email-config", () => ({ assertResendConfigured }));

describe("instrumentation register()", () => {
  const origRuntime = process.env.NEXT_RUNTIME;

  beforeEach(() => {
    assertResendConfigured.mockClear();
  });

  afterEach(() => {
    process.env.NEXT_RUNTIME = origRuntime;
    vi.resetModules();
  });

  it("runs the Resend boot assertion in the nodejs runtime", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const { register } = await import("../../instrumentation");

    await register();

    expect(assertResendConfigured).toHaveBeenCalledOnce();
  });

  it("does NOT run the Resend boot assertion in the edge runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const { register } = await import("../../instrumentation");

    await register();

    expect(assertResendConfigured).not.toHaveBeenCalled();
  });
});
