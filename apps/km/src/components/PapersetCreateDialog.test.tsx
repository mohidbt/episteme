// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";

const routerMock = { push: vi.fn(), refresh: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

import { PapersetCreateDialog } from "./PapersetCreateDialog";

type FetchImpl = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(impl: FetchImpl) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return impl(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  routerMock.push.mockReset();
  routerMock.refresh.mockReset();
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderDialog(folderId: string | null = null) {
  return render(
    <PapersetCreateDialog
      open
      onOpenChange={() => {}}
      folderId={folderId}
    />,
  );
}

describe("PapersetCreateDialog", () => {
  it("posts to API and navigates to /d/:id on success", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/papersets" && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "abc" }), { status: 201 });
      }
      return new Response("nope", { status: 404 });
    });
    renderDialog();
    fireEvent.change(screen.getByLabelText(/filename/i), {
      target: { value: "bench" },
    });
    fireEvent.change(screen.getByLabelText(/column name/i), {
      target: { value: "assay_type" },
    });
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: "what assay" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(routerMock.push).toHaveBeenCalledWith("/d/abc");
    });
    const call = fetchMock.mock.calls.find(
      (c) => c[0] === "/api/papersets",
    );
    expect(call).toBeDefined();
  });

  it("Add column button appends a column row", () => {
    renderDialog();
    expect(screen.getAllByLabelText(/column name/i)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /add column/i }));
    expect(screen.getAllByLabelText(/column name/i)).toHaveLength(2);
  });

  it("submit disabled when filename empty or columns incomplete", () => {
    renderDialog();
    const submit = screen.getByRole("button", {
      name: /^create$/i,
    }) as HTMLButtonElement;
    // initially: filename empty + column empty -> disabled
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/filename/i), {
      target: { value: "x" },
    });
    expect(submit.disabled).toBe(true); // columns still empty

    fireEvent.change(screen.getByLabelText(/column name/i), {
      target: { value: "n" },
    });
    expect(submit.disabled).toBe(true); // description empty

    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: "d" },
    });
    expect(submit.disabled).toBe(false);
  });

  it("sends columns in POST body", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/papersets" && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "id1" }), { status: 201 });
      }
      return new Response("nope", { status: 404 });
    });
    renderDialog("11111111-1111-1111-1111-111111111111");
    fireEvent.change(screen.getByLabelText(/filename/i), {
      target: { value: "bench" },
    });
    fireEvent.change(screen.getByLabelText(/column name/i), {
      target: { value: "col1" },
    });
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: "desc1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(routerMock.push).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/papersets")!;
    const body = JSON.parse(String((call[1] as RequestInit).body));
    expect(body.filename).toBe("bench");
    expect(body.folderId).toBe("11111111-1111-1111-1111-111111111111");
    expect(body.columns).toEqual([{ name: "col1", description: "desc1" }]);
  });

  it("displays server error message on 400", async () => {
    mockFetch(() =>
      new Response(JSON.stringify({ error: "validation failed" }), {
        status: 400,
      }),
    );
    renderDialog();
    fireEvent.change(screen.getByLabelText(/filename/i), {
      target: { value: "bench" },
    });
    fireEvent.change(screen.getByLabelText(/column name/i), {
      target: { value: "c" },
    });
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: "d" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent ?? "").toMatch(/validation failed/i);
    });
    expect(routerMock.push).not.toHaveBeenCalled();
  });
});
