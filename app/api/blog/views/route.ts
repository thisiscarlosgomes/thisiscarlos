import { connectToDatabase } from "@/lib/db";
import { BlogPost } from "@/models/BlogPost";
import { BlogView } from "@/models/BlogView";
import { isOwnerRequest } from "@/lib/voice-notes/auth";
export async function POST(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin) return new Response(null, { status: 403 });
  if (isOwnerRequest(req) || req.headers.get("dnt") === "1" || /bot|crawler|spider|headless/i.test(req.headers.get("user-agent") || "")) return new Response(null, { status: 204 });
  if (Number(req.headers.get("content-length")) > 2048) return new Response(null, { status: 413 });
  try {
    const raw = await req.text();
    if (raw.length > 2048) return new Response(null, { status: 413 });
    const { path, visitor, referrer } = JSON.parse(raw);
    if (typeof path !== "string" || !/^\/blog(?:\/[a-z0-9-]{1,160})?$/.test(path) || typeof visitor !== "string" || !/^[a-f0-9-]{36}$/.test(visitor)) return new Response(null, { status: 400 });
    await connectToDatabase();
    if (path !== "/blog" && !await BlogPost.exists({ slug: path.slice(6), published: true })) return new Response(null, { status: 404 });
    const host = typeof referrer === "string" && /^[a-z0-9.-]{1,253}$/i.test(referrer) ? referrer.toLowerCase() : "direct";
    await BlogView.updateOne({ path, visitor, bucket: Math.floor(Date.now() / 1800000) }, { $setOnInsert: { referrer: host, createdAt: new Date() } }, { upsert: true });
    return new Response(null, { status: 204 });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return new Response(null, { status: 204 });
    return new Response(null, { status: 400 });
  }
}
