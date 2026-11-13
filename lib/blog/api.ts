import { isOwnerRequest } from "@/lib/voice-notes/auth";
export function authorizeBlog(req: Request) {
  if (!isOwnerRequest(req))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (req.method !== "GET") {
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin)
      return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
  return null;
}
export function blogError(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === 11000
  )
    return Response.json(
      { error: "That URL is already used by another post." },
      { status: 409 },
    );
  console.error(
    "Blog request failed",
    error instanceof Error ? error.name : "Unknown error",
  );
  return Response.json(
    { error: "Could not save the post. Please try again." },
    { status: 500 },
  );
}
