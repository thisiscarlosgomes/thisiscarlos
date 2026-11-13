import { BlogViewTracker } from "@/app/components/blog/view-tracker";
import { AudioPlayer } from "@/app/components/blog/audio-player";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { SiteHeader } from "@/app/components/site-header";
import { BlogMarkdown } from "@/app/components/blog/markdown";
import { SharePost } from "@/app/components/blog/share";
import { postDescription, postText } from "@/lib/blog/seo";
import { BLOG_BASE, getPublishedPost } from "@/lib/blog/posts";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getPublishedPost((await params).slug);
  if (!post) return { title: "Post not found", robots: { index: false } };
  const description = postDescription(post.excerpt, post.markdown);
  const image = `${BLOG_BASE}/blog/${post.slug}/share-image?v=${post.updatedAt.getTime()}`;
  return {
    title: post.title.toLowerCase(),
    description,
    authors: [{ name: "Carlos Gomes", url: BLOG_BASE }],
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title: post.title.toLowerCase(),
      description,
      url: `/blog/${post.slug}`,
      type: "article",
      publishedTime: post.publishedAt?.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      authors: ["Carlos Gomes"],
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          type: "image/png",
          alt: post.title.toLowerCase(),
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      creator: "@carlosecgomes",
      title: post.title.toLowerCase(),
      description,
      images: [image],
    },
  };
}
export default async function PostPage({ params }: Props) {
  const { slug } = await params;
  const post = await getPublishedPost(slug);
  if (!post) notFound();
  if (post.slug !== slug) permanentRedirect(`/blog/${post.slug}`);
  const schema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title.toLowerCase(),
    description: postDescription(post.excerpt, post.markdown),
    inLanguage: "en",
    isAccessibleForFree: true,
    wordCount: postText(post.markdown).split(/\s+/).filter(Boolean).length,
    datePublished: post.publishedAt?.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    author: { "@type": "Person", name: "Carlos Gomes", url: BLOG_BASE },
    mainEntityOfPage: `${BLOG_BASE}/blog/${post.slug}`,
    image: `${BLOG_BASE}/blog/${post.slug}/share-image?v=${post.updatedAt.getTime()}`,
  };
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 pb-20 pt-10 sm:px-10">
      <BlogViewTracker path={`/blog/${post.slug}`} />
      <SiteHeader showCallButton={false} />
      <article className="normal-case">
        <Link
          href="/blog"
          className="text-sm text-zinc-500 hover:text-zinc-950"
        >
          All posts
        </Link>
        <h1 className="mt-8 text-4xl font-semibold leading-tight tracking-tight">
          {post.title.toLowerCase()}
        </h1>
        <div className="mt-4 text-sm text-zinc-500">
          <Link href="/" rel="author" className="hover:underline">
            Carlos Gomes
          </Link>{" "}
          ·{" "}
          <time dateTime={post.publishedAt?.toISOString()}>
            {post.publishedAt?.toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
              timeZone: "UTC",
            })}
          </time>{" "}
          ·{" "}
          {Math.max(
            1,
            Math.ceil(postText(post.markdown).split(/\s+/).length / 220),
          )}{" "}
          min read
        </div>
        <div className="mt-5">
          <SharePost
            title={post.title.toLowerCase()}
            url={`${BLOG_BASE}/blog/${post.slug}`}
          />
        </div>
        {post.audioVersion?.url && <AudioPlayer src={post.audioVersion.url} label="Listen to article" />}
        {post.excerpt && (
          <p className="mt-6 text-lg leading-8 text-zinc-600">{post.excerpt}</p>
        )}
        {post.coverImage && (
          <figure className="mt-8">
            <img src={post.coverImage} alt={post.title.toLowerCase()} className="w-full rounded-xl" />
            {post.coverCaption && <figcaption className="mt-2 text-center text-sm text-zinc-500">{post.coverCaption}</figcaption>}
          </figure>
        )}
        <div className="mt-10">
          <BlogMarkdown>{post.markdown}</BlogMarkdown>
        </div>
        <footer className="mt-12 border-t border-zinc-200 pt-6">
          <SharePost
            title={post.title.toLowerCase()}
            url={`${BLOG_BASE}/blog/${post.slug}`}
          />
        </footer>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(schema).replace(/</g, "\\u003c"),
          }}
        />
      </article>
    </main>
  );
}
