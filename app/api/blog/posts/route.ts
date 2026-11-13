import { connectToDatabase } from "@/lib/db";
import { BlogPost } from "@/models/BlogPost";
import { authorizeBlog, blogError } from "@/lib/blog/api";
import { validatePost } from "@/lib/blog/validation";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const denied = authorizeBlog(req);
  if (denied) return denied;
  try {
    await connectToDatabase();
    return Response.json(await BlogPost.find().sort({ updatedAt: -1 }).lean(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return blogError(e);
  }
}
export async function POST(req: Request) {
  const denied = authorizeBlog(req);
  if (denied) return denied;
  let data;
  try {
    data = validatePost(await req.json());
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Invalid post" },
      { status: 400 },
    );
  }
  try {
    await connectToDatabase();
    if (await BlogPost.exists({ $or: [{ slug: data.slug }, { previousSlugs: data.slug }] }))
      return Response.json({ error: "This URL is already used by another post." }, { status: 409 });
    const post = await BlogPost.create({
      ...data,
      publishedAt: data.published ? new Date() : null,
    });
    return Response.json(post, { status: 201 });
  } catch (e) {
    return blogError(e);
  }
}
