import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { references_ } from "@episteme/db/schema";
import { DELETE } from "./route";
import { POST as POST_REF } from "../route";
import { POST as POST_LIB } from "../../libraries/route";
import { createTestUser, deleteTestUser, params, req, type TestUser } from "../../_test-utils";
import { getTrashFolderId } from "@/lib/folders-server";

let u: TestUser;
let libraryId: number;
let keyCounter = 0;

beforeAll(async () => {
  u = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name: "Refs DELETE Guard Lib" }) }),
  );
  libraryId = (await r.json()).id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
});

function uniqueKey(): string {
  return `delguard${Date.now()}${keyCounter++}`;
}

async function createRef(): Promise<string> {
  const r = await POST_REF(
    req("/api/references", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({
        libraryId,
        citationKey: uniqueKey(),
        cslJson: { type: "article-journal", title: "Guard Test Ref" },
      }),
    }),
  );
  if (r.status !== 201) throw new Error(`create ref failed: ${r.status}`);
  return (await r.json()).id as string;
}

describe("DELETE /api/references/:id — trash guard (T20)", () => {
  it("400 rejects delete when reference is not in trash", async () => {
    const refId = await createRef();
    const r = await DELETE(
      req(`/api/references/${refId}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: refId }),
    );
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe("items must be in trash before permanent delete");
  });

  it("204 deletes reference when it is in trash", async () => {
    const refId = await createRef();
    const trashId = await getTrashFolderId(libraryId, u.id);
    // Move to trash directly via DB
    await db.update(references_).set({ folderId: trashId }).where(eq(references_.id, refId));

    const r = await DELETE(
      req(`/api/references/${refId}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: refId }),
    );
    expect(r.status).toBe(204);

    // Row gone
    const [row] = await db.select({ id: references_.id }).from(references_).where(eq(references_.id, refId));
    expect(row).toBeUndefined();
  });
});
