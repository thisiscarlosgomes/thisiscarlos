import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "Browser calling is deprecated. Use phone dial-in via /c." },
    { status: 410 }
  );
}
