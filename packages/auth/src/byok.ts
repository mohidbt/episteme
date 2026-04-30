import { db } from "@episteme/db";
import { userApiKeys } from "@episteme/db/schema";
import { and, eq } from "drizzle-orm";
import { decrypt } from "./encryption";

export async function getDecryptedApiKey(userId: string): Promise<string> {
  if (process.env.INHALE_STUB_EMBEDDINGS === "1") {
    return "stub-api-key";
  }

  const [row] = await db
    .select({ encryptedKey: userApiKeys.encryptedKey })
    .from(userApiKeys)
    .where(
      and(eq(userApiKeys.userId, userId), eq(userApiKeys.providerType, "llm"))
    );

  if (!row) {
    const shared = process.env.EPISTEME_SHARED_LLM_KEY;
    if (shared) return shared;
    throw new Error("NO_LLM_KEY");
  }

  return decrypt(row.encryptedKey);
}

export async function getDecryptedChandraKey(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ encryptedKey: userApiKeys.encryptedKey })
    .from(userApiKeys)
    .where(
      and(
        eq(userApiKeys.userId, userId),
        eq(userApiKeys.providerType, "ocr"),
        eq(userApiKeys.providerName, "chandra"),
      )
    );

  if (!row) return null;

  return decrypt(row.encryptedKey);
}

export async function getUserS2Key(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ encryptedKey: userApiKeys.encryptedKey })
    .from(userApiKeys)
    .where(
      and(eq(userApiKeys.userId, userId), eq(userApiKeys.providerType, "references"))
    );

  if (!row) return null;

  return decrypt(row.encryptedKey);
}
