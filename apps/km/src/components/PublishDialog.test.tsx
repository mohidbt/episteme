// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { PublishDialog } from "./PublishDialog";

type FetchImpl = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(impl: FetchImpl) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return impl(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: /publish/i }));
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PublishDialog", () => {
  it("opens dialog on trigger click", async () => {
    mockFetch(() => new Response("nope", { status: 404 }));
    render(
      <PublishDialog
        noteId="n-1"
        initialUsername="alice"
        initialIsPublic={false}
        initialPublicSlug={null}
        defaultSlug="hello"
      />,
    );
    openDialog();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  });

  it("shows username-claim form when initialUsername is null", async () => {
    mockFetch(() => new Response("nope", { status: 404 }));
    render(
      <PublishDialog
        noteId="n-1"
        initialUsername={null}
        initialIsPublic={false}
        initialPublicSlug={null}
        defaultSlug="hello"
      />,
    );
    openDialog();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(screen.getByTestId("username-input")).toBeTruthy();
    expect(screen.getByRole("button", { name: /claim/i })).toBeTruthy();
    expect(screen.queryByTestId("public-toggle")).toBeNull();
    expect(screen.queryByTestId("slug-input")).toBeNull();
  });

  it("claims username on submit and shows publish controls", async () => {
    mockFetch((url, init) => {
      if (url === "/api/users/username" && init?.method === "POST") {
        return new Response(JSON.stringify({ username: "alice" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("nope", { status: 404 });
    });
    render(
      <PublishDialog
        noteId="n-1"
        initialUsername={null}
        initialIsPublic={false}
        initialPublicSlug={null}
        defaultSlug="hello"
      />,
    );
    openDialog();
    const input = screen.getByTestId("username-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "alice" } });
    fireEvent.click(screen.getByRole("button", { name: /claim/i }));
    await waitFor(() => {
      expect(screen.getByTestId("public-toggle")).toBeTruthy();
    });
    expect(screen.getByTestId("slug-input")).toBeTruthy();
  });

  it("renders URL preview from username + publicSlug", async () => {
    mockFetch(() => new Response("nope", { status: 404 }));
    render(
      <PublishDialog
        noteId="n-1"
        initialUsername="alice"
        initialIsPublic={false}
        initialPublicSlug="hello"
        defaultSlug="hello"
      />,
    );
    openDialog();
    await waitFor(() => {
      expect(screen.getByTestId("url-preview").textContent).toContain(
        "alice.epistaime.com/hello",
      );
    });
  });

  it("toggle to public: POSTs with isPublic=true + publicSlug, updates state on 200", async () => {
    let patchBody: string | null = null;
    mockFetch((url, init) => {
      if (url === "/api/notes/n-1/publish" && init?.method === "POST") {
        patchBody = String(init.body);
        return new Response(
          JSON.stringify({ isPublic: true, publicSlug: "hello" }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response("nope", { status: 404 });
    });
    render(
      <PublishDialog
        noteId="n-1"
        initialUsername="alice"
        initialIsPublic={false}
        initialPublicSlug="hello"
        defaultSlug="hello"
      />,
    );
    openDialog();
    const toggle = (await waitFor(() =>
      screen.getByTestId("public-toggle"),
    )) as HTMLInputElement;
    fireEvent.click(toggle);
    await waitFor(() => expect(patchBody).not.toBeNull());
    const parsed = JSON.parse(patchBody!) as {
      isPublic: boolean;
      publicSlug: string;
    };
    expect(parsed.isPublic).toBe(true);
    expect(parsed.publicSlug).toBe("hello");
    await waitFor(() =>
      expect(screen.getByTestId("copy-url")).toBeTruthy(),
    );
  });

  it("Copy URL writes to clipboard", async () => {
    mockFetch((url, init) => {
      if (url === "/api/notes/n-1/publish" && init?.method === "POST") {
        return new Response(
          JSON.stringify({ isPublic: true, publicSlug: "hello" }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response("nope", { status: 404 });
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <PublishDialog
        noteId="n-1"
        initialUsername="alice"
        initialIsPublic={true}
        initialPublicSlug="hello"
        defaultSlug="hello"
      />,
    );
    openDialog();
    const copyBtn = await waitFor(() => screen.getByTestId("copy-url"));
    fireEvent.click(copyBtn);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://alice.epistaime.com/hello");
    });
  });

  it("shows 'slug taken' message on 409", async () => {
    mockFetch((url, init) => {
      if (url === "/api/notes/n-1/publish" && init?.method === "POST") {
        return new Response(JSON.stringify({ error: "slug_taken" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("nope", { status: 404 });
    });
    render(
      <PublishDialog
        noteId="n-1"
        initialUsername="alice"
        initialIsPublic={false}
        initialPublicSlug="hello"
        defaultSlug="hello"
      />,
    );
    openDialog();
    const toggle = (await waitFor(() =>
      screen.getByTestId("public-toggle"),
    )) as HTMLInputElement;
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByTestId("publish-error").textContent).toMatch(
        /slug is taken/i,
      );
    });
    const toggleAfter = screen.getByTestId("public-toggle") as HTMLInputElement;
    expect(toggleAfter.checked).toBe(false);
    expect(screen.queryByTestId("copy-url")).toBeNull();
  });
});
