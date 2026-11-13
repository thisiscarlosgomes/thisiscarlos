import type { MetadataRoute } from "next";

import { getPublishedPosts } from "@/lib/blog/posts";

export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await getPublishedPosts();
  const base = "https://carlos.cv";

  return [
    { url: `${base}/wiki`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/blog`, changeFrequency: "weekly", priority: 0.8 },
    ...posts.map((post) => ({
      url: `${base}/blog/${post.slug}`,
      lastModified: post.updatedAt,
      priority: 0.7,
    })),
    {
      url: `${base}/`,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${base}/c`,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${base}/p`,
      changeFrequency: "weekly",
      priority: 0.7,
    },
  ];
}
