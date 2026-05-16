// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SignupForm } from "./SignupForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  // Default: session probe → not a guest. Tests override as needed.
  mockFetch((url) => {
    if (url.endsWith("/api/auth/get-session")) {
      return new Response(JSON.stringify({ user: { isAnonymous: false } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("nope", { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fillRequired() {
  fireEvent.change(screen.getByLabelText(/first name/i), {
    target: { value: "Alex" },
  });
  fireEvent.change(screen.getByLabelText(/username/i), {
    target: { value: "alex_99" },
  });
  fireEvent.change(screen.getByLabelText(/email/i), {
    target: { value: "alex@example.com" },
  });
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: "supersecret1" },
  });
  fireEvent.change(screen.getByLabelText(/invite code/i), {
    target: { value: "INVITE-ABC" },
  });
}

describe("SignupForm", () => {
  it("rejects submission when pokemon is not selected", async () => {
    const onSuccess = vi.fn();
    render(<SignupForm onSuccess={onSuccess} />);
    fillRequired();
    // Pick userType but skip pokemon.
    fireEvent.click(screen.getByText("Student"));

    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/pokemon/i);
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("rejects submission when invite code is missing", async () => {
    const onSuccess = vi.fn();
    const { container } = render(<SignupForm onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText(/first name/i), {
      target: { value: "Alex" },
    });
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "alex_99" },
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "alex@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "supersecret1" },
    });
    fireEvent.click(screen.getByText("Student"));
    fireEvent.click(screen.getByTestId("pokemon-squirtle"));

    // Submit the <form> directly; native `required` on the invite Input
    // would otherwise short-circuit our handleSubmit-based validation
    // (which is the layer we want to assert).
    const form = container.querySelector("form")!;
    fireEvent.submit(form);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/invite/i);
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("rejects username with uppercase / disallowed chars", async () => {
    const onSuccess = vi.fn();
    render(<SignupForm onSuccess={onSuccess} />);
    // We bypass the input's onChange lowercasing by setting value directly to
    // simulate paste-with-invalid-chars. Use a colon (disallowed).
    fireEvent.change(screen.getByLabelText(/first name/i), {
      target: { value: "Alex" },
    });
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "bad:name" },
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "alex@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "supersecret1" },
    });
    fireEvent.click(screen.getByText("Student"));
    fireEvent.click(screen.getByTestId("pokemon-charmander"));
    fireEvent.change(screen.getByLabelText(/invite code/i), {
      target: { value: "INVITE-ABC" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/username/i);
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("submits the full payload to /api/auth/signup-real and calls onSuccess", async () => {
    const onSuccess = vi.fn();
    const fetchMock = mockFetch((url) => {
      if (url.endsWith("/api/auth/get-session")) {
        return new Response(
          JSON.stringify({ user: { isAnonymous: false } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/auth/signup-real")) {
        return new Response(
          JSON.stringify({ ok: true, userId: "u_test" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("nope", { status: 404 });
    });

    render(<SignupForm onSuccess={onSuccess} />);
    fillRequired();
    fireEvent.click(screen.getByText("Researcher"));
    fireEvent.click(screen.getByTestId("pokemon-bulbasaur"));
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));

    const signupCall = fetchMock.mock.calls.find(
      (c) => String(c[0]).endsWith("/api/auth/signup-real"),
    );
    expect(signupCall).toBeDefined();
    const body = JSON.parse((signupCall![1] as RequestInit).body as string);
    expect(body).toEqual({
      firstname: "Alex",
      username: "alex_99",
      email: "alex@example.com",
      password: "supersecret1",
      userType: "researcher",
      pokemon: "bulbasaur",
      inviteCode: "INVITE-ABC",
    });
  });

  it("surfaces invite_invalid error from server", async () => {
    const onSuccess = vi.fn();
    mockFetch((url) => {
      if (url.endsWith("/api/auth/get-session")) {
        return new Response(
          JSON.stringify({ user: { isAnonymous: false } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/auth/signup-real")) {
        return new Response(JSON.stringify({ error: "invite_invalid" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("nope", { status: 404 });
    });

    render(<SignupForm onSuccess={onSuccess} />);
    fillRequired();
    fireEvent.click(screen.getByText("Student"));
    fireEvent.click(screen.getByTestId("pokemon-charmander"));
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/invite/i);
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
