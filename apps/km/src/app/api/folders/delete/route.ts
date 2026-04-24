import { NextResponse } from "next/server";

export async function POST(_req?: Request) {
  return NextResponse.json(
    { error: "deprecated — use POST /api/folders/trash" },
    { status: 410 },
  );
}
