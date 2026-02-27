import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const VOICE_NOTES_OWNER_COOKIE = "voice_notes_owner";

function isProtectedApi(pathname: string): boolean {
  if (!pathname.startsWith("/api/voice-notes")) return false;
  return pathname !== "/api/voice-notes/auth" && pathname !== "/api/voice-notes/context";
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtectedPage = pathname.startsWith("/v");
  const protectedApi = isProtectedApi(pathname);

  if (!isProtectedPage && !protectedApi) {
    return NextResponse.next();
  }

  const expected = process.env.VOICE_NOTES_OWNER_PASSWORD ?? "";
  const cookieValue = req.cookies.get(VOICE_NOTES_OWNER_COOKIE)?.value ?? "";
  const isAuthed = Boolean(expected) && cookieValue === expected;

  if (isAuthed) {
    return NextResponse.next();
  }

  if (protectedApi) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/lg";
  if (pathname !== "/lg") {
    url.searchParams.set("next", pathname);
  }
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/v/:path*", "/api/voice-notes/:path*"],
};
