import { NextResponse } from "next/server";

export async function POST(_req?: Request) {
  return NextResponse.json(
    { error: "deprecated — use PATCH /api/folders/:id" },
    { status: 410 },
  );
}
