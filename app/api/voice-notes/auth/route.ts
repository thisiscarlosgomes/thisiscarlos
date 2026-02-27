import { NextResponse } from "next/server";
import {
  VOICE_NOTES_OWNER_COOKIE,
  createOwnerSessionValue,
  getOwnerPassword,
  isOwnerPasswordValid,
} from "@/lib/voice-notes/auth";

export const runtime = "nodejs";

type LoginBody = {
  password?: string;
};

export async function POST(req: Request) {
  const configuredPassword = getOwnerPassword();
  if (!configuredPassword) {
    return NextResponse.json({ error: "VOICE_NOTES_OWNER_PASSWORD is not configured" }, { status: 500 });
  }

  let body: LoginBody;
  try {
    body = (await req.json()) as LoginBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const password = String(body.password ?? "");
  if (!isOwnerPasswordValid(password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: VOICE_NOTES_OWNER_COOKIE,
    value: createOwnerSessionValue(),
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: VOICE_NOTES_OWNER_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
