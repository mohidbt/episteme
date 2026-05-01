// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getSessionInfo: vi.fn(),
}));

vi.mock("@/lib/agent-config-bundle", () => ({
  parseBundle: vi.fn(),
  diffBundle: vi.fn(),
  applyBundle: vi.fn(),
}));

import { getSessionInfo } from "@/lib/auth";
import { parseBundle, diffBundle, applyBundle } from "@/lib/agent-config-bundle";

const FAKE_BUNDLE = {
  agent_config: {
    enabledSkills: [],
    attachedMcps: [],
    modelPreference: "",
    approvalRules: {},
    settingsJson: {},
  },
  skills: [],
  memories: [],
  settings_json: {},
};
const FAKE_DIFF = {
  skills: { added: [], removed: [], modified: [] },
  memories: { added: [], removed: [], modified: [] },
  settings: { changed: [] },
};

function fdReq(fd: FormData): Request {
  return new Request("http://localhost/api/agent/import", {
    method: "POST",
    body: fd,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionInfo).mockResolvedValue({ userId: "u1", isAnonymous: false });
  vi.mocked(parseBundle).mockResolvedValue(FAKE_BUNDLE as never);
  vi.mocked(diffBundle).mockResolvedValue(FAKE_DIFF as never);
  vi.mocked(applyBundle).mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/agent/import", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null);
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([1, 2])], "b.zip"));
    const { POST } = await import("./route");
    const res = await POST(fdReq(fd));
    expect(res.status).toBe(401);
  });

  it("400 when file missing", async () => {
    const fd = new FormData();
    const { POST } = await import("./route");
    const res = await POST(fdReq(fd));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("missing_file");
  });

  it("400 when zip is invalid", async () => {
    vi.mocked(parseBundle).mockRejectedValue(new Error("bad zip"));
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([0])], "b.zip"));
    const { POST } = await import("./route");
    const res = await POST(fdReq(fd));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_bundle");
  });

  it("returns diff JSON without confirm; does not apply", async () => {
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([0x50, 0x4b])], "b.zip"));
    const { POST } = await import("./route");
    const res = await POST(fdReq(fd));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ diff: FAKE_DIFF });
    expect(diffBundle).toHaveBeenCalledWith("u1", FAKE_BUNDLE);
    expect(applyBundle).not.toHaveBeenCalled();
  });

  it("applies and returns ok with confirm=true", async () => {
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([0x50, 0x4b])], "b.zip"));
    fd.append("confirm", "true");
    const { POST } = await import("./route");
    const res = await POST(fdReq(fd));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(applyBundle).toHaveBeenCalledWith("u1", FAKE_BUNDLE);
    expect(diffBundle).not.toHaveBeenCalled();
  });
});
