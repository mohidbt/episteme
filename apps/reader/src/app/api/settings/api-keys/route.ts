import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { db } from "@episteme/db";
import { userApiKeys } from "@episteme/db/schema";
import { eq, and } from "drizzle-orm";
import { encrypt } from "@episteme/auth/encryption";

const VALID_PROVIDER_TYPES = ["llm", "voice", "ocr", "references"] as const;
type ProviderType = (typeof VALID_PROVIDER_TYPES)[number];

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const keys = await db
      .select({
        id: userApiKeys.id,
        providerType: userApiKeys.providerType,
        providerName: userApiKeys.providerName,
        keyPreview: userApiKeys.keyPreview,
        isValid: userApiKeys.isValid,
        storageMode: userApiKeys.storageMode,
        createdAt: userApiKeys.createdAt,
      })
      .from(userApiKeys)
      .where(eq(userApiKeys.userId, session.user.id));

    return NextResponse.json({ keys });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 422 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 422 });
  }

  const { providerType, providerName, apiKey, storageMode } = body as Record<string, unknown>;

  if (
    !providerType ||
    !providerName ||
    !apiKey ||
    typeof providerType !== "string" ||
    typeof providerName !== "string" ||
    typeof apiKey !== "string" ||
    !VALID_PROVIDER_TYPES.includes(providerType as ProviderType) ||
    providerName.trim() === "" ||
    apiKey.trim() === ""
  ) {
    return NextResponse.json(
      { error: "providerType, providerName, and apiKey are required. providerType must be one of: llm, voice, ocr, references." },
      { status: 422 }
    );
  }

  const validStorageMode =
    storageMode === "browser_only" ? "browser_only" : "cloud";

  try {
    const keyPreview = "..." + apiKey.slice(-4);
    const encryptedKey = encrypt(apiKey);

    const existing = await db
      .select({ id: userApiKeys.id })
      .from(userApiKeys)
      .where(
        and(
          eq(userApiKeys.userId, session.user.id),
          eq(userApiKeys.providerType, providerType as ProviderType),
          eq(userApiKeys.providerName, providerName.trim())
        )
      )
      .limit(1);

    let result: typeof userApiKeys.$inferSelect;

    if (existing.length > 0) {
      const updated = await db
        .update(userApiKeys)
        .set({
          encryptedKey,
          keyPreview,
          storageMode: validStorageMode,
          isValid: null,
          lastValidatedAt: null,
        })
        .where(
          and(
            eq(userApiKeys.id, existing[0].id),
            eq(userApiKeys.userId, session.user.id)
          )
        )
        .returning();
      if (!updated || updated.length === 0) {
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
      }
      result = updated[0];
    } else {
      const inserted = await db
        .insert(userApiKeys)
        .values({
          userId: session.user.id,
          providerType: providerType as ProviderType,
          providerName: providerName.trim(),
          encryptedKey,
          keyPreview,
          storageMode: validStorageMode,
        })
        .returning();
      if (!inserted || inserted.length === 0) {
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
      }
      result = inserted[0];
    }

    return NextResponse.json(
      {
        key: {
          id: result.id,
          providerType: result.providerType,
          providerName: result.providerName,
          keyPreview: result.keyPreview,
          isValid: result.isValid,
          storageMode: result.storageMode,
          createdAt: result.createdAt,
        },
      },
      { status: existing.length > 0 ? 200 : 201 }
    );
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keyIdParam = request.nextUrl.searchParams.get("keyId");
  if (!keyIdParam || isNaN(Number(keyIdParam))) {
    return NextResponse.json({ error: "keyId query param is required and must be a number" }, { status: 400 });
  }
  const keyId = Number(keyIdParam);

  try {
    await db
      .delete(userApiKeys)
      .where(
        and(
          eq(userApiKeys.id, keyId),
          eq(userApiKeys.userId, session.user.id)
        )
      );

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
