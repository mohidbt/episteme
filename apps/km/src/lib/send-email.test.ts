import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "./send-email";

describe("sendEmail", () => {
  const origKey = process.env.RESEND_API_KEY;
  const origFrom = process.env.ALERT_EMAIL_FROM;

  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.ALERT_EMAIL_FROM = "alerts@tryepisteme.com";
  });

  afterEach(() => {
    process.env.RESEND_API_KEY = origKey;
    process.env.ALERT_EMAIL_FROM = origFrom;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("POSTs the correct Resend payload and returns true on 200", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const ok = await sendEmail({
      to: "u@example.com",
      subject: "Hello",
      text: "body text",
      html: "<p>body</p>",
    });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_test_key");
    const payload = JSON.parse(init.body as string);
    expect(payload).toMatchObject({
      from: "alerts@tryepisteme.com",
      to: ["u@example.com"],
      subject: "Hello",
      text: "body text",
      html: "<p>body</p>",
    });
  });

  it("honours an explicit from override", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({
      to: "u@example.com",
      from: "custom@tryepisteme.com",
      subject: "x",
      text: "y",
    });

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(payload.from).toBe("custom@tryepisteme.com");
  });

  it("returns false and does not fetch when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const ok = await sendEmail({ to: "u@example.com", subject: "x", text: "y" });

    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("returns false (no throw) when fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const ok = await sendEmail({ to: "u@example.com", subject: "x", text: "y" });
    expect(ok).toBe(false);
  });

  it("returns false (no throw) when Resend responds non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 422 })),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const ok = await sendEmail({ to: "u@example.com", subject: "x", text: "y" });
    expect(ok).toBe(false);
  });
});
