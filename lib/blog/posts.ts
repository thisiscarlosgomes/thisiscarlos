import { cache } from "react";
import { connectToDatabase } from "@/lib/db";
import { BlogPost } from "@/models/BlogPost";
export const BLOG_BASE = "https://carlos.cv";
export const getPublishedPosts = cache(async () => {
  await connectToDatabase();
  return BlogPost.find({ published: true })
    .select("-markdown")
    .sort({ publishedAt: -1 })
    .lean();
});
export const getPublishedPost = cache(async (slug: string) => {
  await connectToDatabase();
  return BlogPost.findOne({ $or: [{ slug }, { previousSlugs: slug }], published: true }).lean();
});

export const getRecentPublishedPosts = cache(async () => {
  await connectToDatabase();
  return BlogPost.find({ published: true })
    .select("title slug publishedAt")
    .sort({ publishedAt: -1, _id: -1 })
    .limit(5)
    .lean();
});
