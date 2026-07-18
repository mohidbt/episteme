// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from "sonner";
import { NewNoteDialog, RenameFolderDialog } from "./SidebarDialogs";

type FetchImpl = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(impl: FetchImpl) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return impl(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function guestResponse() {
  return new Response(JSON.stringify({ error: "guest_forbidden" }), {
    status: 403,
  });
}

function errorMessages() {
  const errorMock = toast.error as ReturnType<typeof vi.fn>;
  return errorMock.mock.calls.map((c) => String(c[0]).toLowerCase());
}

beforeEach(() => {
  (toast.error as ReturnType<typeof vi.fn>).mockClear();
  (toast.success as ReturnType<typeof vi.fn>).mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SidebarDialogs guest-mode toast", () => {
  it("note-create on 403 guest_forbidden shows guest toast, not 'Create failed'", async () => {
    mockFetch((url, init) => {
      if (url === "/api/notes" && init?.method === "POST") return guestResponse();
      return new Response("nope", { status: 404 });
    });
    render(
      <NewNoteDialog
        open
        onOpenChange={() => {}}
        onMutate={() => {}}
        libraryId={1}
        folderPath=""
      />,
    );
    const input = (await waitFor(() =>
      screen.getByLabelText(/title/i),
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const messages = errorMessages();
    expect(messages.some((m) => m.includes("guest mode"))).toBe(true);
    expect(messages.some((m) => m.includes("create failed"))).toBe(false);
  });

  it("folder-rename on 403 guest_forbidden shows guest toast, not 'Rename failed'", async () => {
    mockFetch((url, init) => {
      if (url.startsWith("/api/folders/") && init?.method === "PATCH")
        return guestResponse();
      return new Response("nope", { status: 404 });
    });
    render(
      <RenameFolderDialog
        open
        onOpenChange={() => {}}
        onMutate={() => {}}
        folderId="f1"
        currentName="Old"
      />,
    );
    const input = (await waitFor(() =>
      screen.getByLabelText(/folder name/i),
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "New" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const messages = errorMessages();
    expect(messages.some((m) => m.includes("guest mode"))).toBe(true);
    expect(messages.some((m) => m.includes("rename failed"))).toBe(false);
  });
});
