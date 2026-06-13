import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  init: vi.fn(),
  feedbackIntegration: vi.fn(() => ({ name: "Feedback" })),
  replayIntegration: vi.fn(() => ({ name: "Replay" })),
  captureRequestError: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
  captureException: vi.fn(),
  showReportDialog: vi.fn(),
}));

const SENTRY_DSN =
  "https://1a4aee926c61d29a0d00cb44ef98def0@o4511507739049984.ingest.de.sentry.io/4511507747373136";

describe("sentry client config (instrumentation-client.ts)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("calls Sentry.init with correct DSN and includes feedback + replay integrations", async () => {
    const Sentry = await import("@sentry/nextjs");
    await import("../../../instrumentation-client");

    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const opts = (Sentry.init as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(opts.dsn).toBe(SENTRY_DSN);
    expect(Array.isArray(opts.integrations)).toBe(true);
    expect(Sentry.feedbackIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        colorScheme: "system",
        autoInject: true,
        showBranding: false,
      }),
    );
    expect(Sentry.replayIntegration).toHaveBeenCalled();
  });

  it("sets replay sample rates: session=0, onError=1.0", async () => {
    const Sentry = await import("@sentry/nextjs");
    await import("../../../instrumentation-client");
    const opts = (Sentry.init as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(opts.replaysSessionSampleRate).toBe(0);
    expect(opts.replaysOnErrorSampleRate).toBe(1.0);
  });

  it("sets tracePropagationTargets for localhost + prod + vercel previews", async () => {
    const Sentry = await import("@sentry/nextjs");
    await import("../../../instrumentation-client");
    const opts = (Sentry.init as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(opts.tracePropagationTargets).toEqual(
      expect.arrayContaining([
        "localhost",
        expect.any(RegExp),
        expect.any(RegExp),
      ]),
    );
  });
});

describe("sentry server config (instrumentation.ts register hook)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("exports register() and onRequestError", async () => {
    const mod = await import("../../../instrumentation");
    expect(typeof mod.register).toBe("function");
    expect(typeof mod.onRequestError).toBe("function");
  });

  it("server config initializes Sentry with DSN and traces sample rate", async () => {
    const Sentry = await import("@sentry/nextjs");
    await import("../../../sentry.server.config");
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const opts = (Sentry.init as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(opts.dsn).toBe(SENTRY_DSN);
    expect(typeof opts.tracesSampleRate).toBe("number");
  });

  it("edge config initializes Sentry with DSN", async () => {
    const Sentry = await import("@sentry/nextjs");
    await import("../../../sentry.edge.config");
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const opts = (Sentry.init as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(opts.dsn).toBe(SENTRY_DSN);
  });
});

describe("next.config.ts withSentryConfig wrapper", () => {
  it("wraps config with withSentryConfig", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const cfgPath = path.resolve(__dirname, "../../../next.config.ts");
    const src = await fs.readFile(cfgPath, "utf8");
    expect(src).toMatch(/withSentryConfig/);
    expect(src).toMatch(/@sentry\/nextjs/);
    expect(src).toMatch(/episteme-rb/);
    expect(src).toMatch(/tryepisteme/);
    expect(src).toMatch(/SENTRY_AUTH_TOKEN/);
  });
});

describe("global-error.tsx", () => {
  it("imports Sentry and captures exception", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const errPath = path.resolve(
      __dirname,
      "../../app/global-error.tsx",
    );
    const src = await fs.readFile(errPath, "utf8");
    expect(src).toMatch(/@sentry\/nextjs/);
    expect(src).toMatch(/captureException/);
  });
});
