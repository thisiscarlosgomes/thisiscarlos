import { connectToDatabase } from "@/lib/db";
import { BlogPost } from "@/models/BlogPost";
import { authorizeBlog, blogError } from "@/lib/blog/api";
import { validatePost } from "@/lib/blog/validation";
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = authorizeBlog(req);
  if (denied) return denied;
  const { id } = await params;
  if (!/^[a-f0-9]{24}$/.test(id))
    return Response.json({ error: "Invalid post" }, { status: 400 });
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
    const post = await BlogPost.findById(id);
    if (!post)
      return Response.json({ error: "Post not found" }, { status: 404 });
    if (post.slug !== data.slug) {
      const taken = await BlogPost.exists({ _id: { $ne: post._id }, $or: [{ slug: data.slug }, { previousSlugs: data.slug }] });
      if (taken) return Response.json({ error: "This URL is already used by another post." }, { status: 409 });
      if (post.publishedAt) post.previousSlugs = [...new Set([...(post.previousSlugs || []), post.slug])].filter((slug) => slug !== data.slug);
    }
    Object.assign(post, data);
    if (data.published && !post.publishedAt) post.publishedAt = new Date();
    await post.save();
    return Response.json(post);
  } catch (e) {
    return blogError(e);
  }
}
