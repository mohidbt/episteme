// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import { SignupForm } from "./SignupForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function bodyOf(call: [unknown, unknown?]) {
  return JSON.parse((call[1] as RequestInit).body as string);
}

beforeEach(() => {
  mockFetch((url) => {
    if (url.endsWith("/api/auth/get-session")) {
      return json({ user: { isAnonymous: false } });
    }
    return new Response("nope", { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function continueStep() {
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
}

async function reachEmailStep() {
  fireEvent.change(screen.getByLabelText(/first name/i), {
    target: { value: "Alex" },
  });
  fireEvent.change(screen.getByLabelText(/username/i), {
    target: { value: "Alex_99" },
  });
  await continueStep();
}

async function reachPersonaStep() {
  await reachEmailStep();
  fireEvent.change(screen.getByLabelText(/^email$/i), {
    target: { value: "alex@example.com" },
  });
  await continueStep();
}

async function reachStarterStepForIndustry() {
  await reachPersonaStep();
  fireEvent.click(screen.getByRole("radio", { name: /industry/i }));
  await continueStep();
  fireEvent.change(screen.getByLabelText(/job role/i), {
    target: { value: "Product lead" },
  });
  fireEvent.change(screen.getByLabelText(/^industry$/i), {
    target: { value: "Biotech" },
  });
  await continueStep();
}

async function reachInviteStepForIndustry() {
  await reachStarterStepForIndustry();
  fireEvent.click(screen.getByTestId("pokemon-bulbasaur"));
  await continueStep();
}

describe("SignupForm", () => {
  it("progresses through wizard frames and keeps sign-in available", async () => {
    render(<SignupForm />);

    expect(screen.getByText(/step 1 of 7/i)).toBeTruthy();
    expect(
      (screen.getByRole("link", { name: /sign in/i }) as HTMLAnchorElement)
        .href,
    ).toContain("/sign-in");

    await reachEmailStep();
    expect(screen.getByText(/step 2 of 7/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /sign in/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByText(/step 1 of 7/i)).toBeTruthy();
  });

  it("blocks invalid email before advancing or validating an invite", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.endsWith("/api/auth/get-session")) {
        return json({ user: { isAnonymous: false } });
      }
      if (url.endsWith("/api/auth/invite/validate")) {
        return json({ ok: true });
      }
      return new Response("nope", { status: 404 });
    });

    render(<SignupForm />);
    await reachEmailStep();
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "not-email" },
    });
    await continueStep();

    expect(screen.getByRole("alert").textContent).toMatch(/valid email/i);
    expect(screen.getByText(/step 2 of 7/i)).toBeTruthy();
    expect(
      fetchMock.mock.calls.some((c) =>
        String(c[0]).endsWith("/api/auth/invite/validate"),
      ),
    ).toBe(false);
  });

  it("posts waitlist without password and shows a success toast", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.endsWith("/api/auth/get-session")) {
        return json({ user: { isAnonymous: false } });
      }
      if (url.endsWith("/api/auth/waitlist")) return json({ ok: true });
      return new Response("nope", { status: 404 });
    });

    render(<SignupForm />);
    await reachInviteStepForIndustry();
    fireEvent.change(screen.getByLabelText(/invite code/i), {
      target: { value: "BAD-CODE" },
    });
    fireEvent.click(screen.getByRole("button", { name: /join waitlist/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        "You're on the waitlist",
        expect.any(Object),
      );
    });

    const waitlistCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).endsWith("/api/auth/waitlist"),
    );
    expect(waitlistCall).toBeDefined();
    const body = bodyOf(waitlistCall!);
    expect(body).toMatchObject({
      firstname: "Alex",
      username: "alex_99",
      email: "alex@example.com",
      userType: "industry",
      pokemon: "bulbasaur",
      jobRole: "Product lead",
      industry: "Biotech",
      attemptedInviteCode: "BAD-CODE",
    });
    expect(body.password).toBeUndefined();
  });

  it("can join the waitlist without entering an invite code", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.endsWith("/api/auth/get-session")) {
        return json({ user: { isAnonymous: false } });
      }
      if (url.endsWith("/api/auth/waitlist")) return json({ ok: true });
      return new Response("nope", { status: 404 });
    });

    render(<SignupForm />);
    await reachInviteStepForIndustry();
    fireEvent.click(screen.getByRole("button", { name: /join waitlist/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        "You're on the waitlist",
        expect.any(Object),
      );
    });

    const waitlistCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).endsWith("/api/auth/waitlist"),
    );
    expect(waitlistCall).toBeDefined();
    const body = bodyOf(waitlistCall!);
    expect(body.attemptedInviteCode).toBeUndefined();
    expect(body.password).toBeUndefined();
    expect(screen.queryByText(/enter an invite code/i)).toBeNull();
  });

  it("validates invite before showing the password step and blocks invalid codes", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.endsWith("/api/auth/get-session")) {
        return json({ user: { isAnonymous: false } });
      }
      if (url.endsWith("/api/auth/invite/validate")) {
        return json({ error: "invite_invalid" }, 400);
      }
      return new Response("nope", { status: 404 });
    });

    render(<SignupForm />);
    await reachInviteStepForIndustry();
    fireEvent.change(screen.getByLabelText(/invite code/i), {
      target: { value: "BAD-CODE" },
    });
    await continueStep();

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/invite/i);
    });
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(
      fetchMock.mock.calls.some((c) =>
        String(c[0]).endsWith("/api/auth/invite/validate"),
      ),
    ).toBe(true);
  });

  it("submits final signup payload with industry details to the endpoint prop", async () => {
    const onSuccess = vi.fn();
    const fetchMock = mockFetch((url) => {
      if (url.endsWith("/api/auth/get-session")) {
        return json({ user: { isAnonymous: false } });
      }
      if (url.endsWith("/api/auth/invite/validate")) {
        return json({ ok: true });
      }
      if (url.endsWith("/test/signup")) {
        return json({ ok: true, userId: "u_test" });
      }
      return new Response("nope", { status: 404 });
    });

    render(<SignupForm endpoint="/test/signup" onSuccess={onSuccess} />);
    await reachInviteStepForIndustry();
    fireEvent.change(screen.getByLabelText(/invite code/i), {
      target: { value: "INVITE-ABC" },
    });
    await continueStep();
    fireEvent.change(await screen.findByLabelText(/password/i), {
      target: { value: "supersecret1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));

    const signupCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).endsWith("/test/signup"),
    );
    expect(signupCall).toBeDefined();
    expect(bodyOf(signupCall!)).toEqual({
      firstname: "Alex",
      username: "alex_99",
      email: "alex@example.com",
      password: "supersecret1",
      userType: "industry",
      pokemon: "bulbasaur",
      inviteCode: "INVITE-ABC",
      jobRole: "Product lead",
      industry: "Biotech",
    });
  });

  it("shows guest data warning when session is anonymous", async () => {
    mockFetch((url) => {
      if (url.endsWith("/api/auth/get-session")) {
        return json({ user: { isAnonymous: true } });
      }
      return new Response("nope", { status: 404 });
    });

    render(<SignupForm />);

    expect(await screen.findByTestId("guest-data-warning")).toBeTruthy();
  });
});
