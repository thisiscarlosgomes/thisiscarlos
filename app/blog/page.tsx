import { BlogViewTracker } from "@/app/components/blog/view-tracker";
import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/app/components/site-header";
import { getPublishedPosts } from "@/lib/blog/posts";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Blog",
  description:
    "Notes and essays by Carlos Gomes on AI, crypto, and things worth exploring.",
  alternates: { canonical: "/blog" },
  openGraph: {
    title: "Blog | Carlos",
    description: "Notes and essays by Carlos Gomes.",
    url: "/blog",
    type: "website",
    images: ["/og"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Blog | Carlos",
    description: "Notes and essays by Carlos Gomes.",
    images: ["/og"],
  },
};
export default async function BlogPage() {
  const posts = await getPublishedPosts();
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 pb-20 pt-10 sm:px-10">
      <BlogViewTracker path={"/blog"} />
      <SiteHeader showCallButton={false} />
      <h1 className="text-3xl font-semibold tracking-tight">blog</h1>
      <p className="mt-3 text-sm text-zinc-500">
        notes, ideas, and things worth exploring.
      </p>
      <div className="mt-12 divide-y divide-zinc-200 normal-case">
        {posts.length ? (
          posts.map((post) => (
            <article key={String(post._id)} className="py-4 first:pt-0">
              <time
                className="text-xs text-zinc-500"
                dateTime={post.publishedAt?.toISOString()}
              >
                {post.publishedAt?.toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "UTC",
                })}
              </time>
              <h2 className="mt-2 text-xl font-medium">
                <Link
                  className="hover:underline underline-offset-4"
                  href={`/blog/${post.slug}`}
                >
                  {post.title.toLowerCase()}
                </Link>
              </h2>
              {post.excerpt && (
                <p className="mt-3 text-sm leading-7 text-zinc-600">
                  {post.excerpt}
                </p>
              )}
            </article>
          ))
        ) : (
          <p className="text-sm text-zinc-500">No posts yet. More soon.</p>
        )}
      </div>
    </main>
  );
}
