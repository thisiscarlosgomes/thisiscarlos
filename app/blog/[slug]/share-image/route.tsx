import { ImageResponse } from "next/og";
import { getPublishedPost } from "@/lib/blog/posts";
import { firstPostImage } from "@/lib/blog/seo";
import { BlogMedia } from "@/models/BlogMedia";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const post = await getPublishedPost((await params).slug);
  if (!post) return new Response(null, { status: 404 });
  const imageUrl = post.coverImage || firstPostImage(post.markdown);
  const id = imageUrl?.match(/^\/api\/blog\/media\/([a-f0-9]{24})$/)?.[1];
  let image: string | undefined;
  if (id) {
    const media = await BlogMedia.findById(id);
    if (
      media &&
      ["image/png", "image/jpeg", "image/webp"].includes(media.mimeType)
    )
      image = `data:${media.mimeType};base64,${Buffer.from(media.data).toString("base64")}`;
  }
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: "#fafaf9",
        color: "#18181b",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          width: image ? 760 : 1200,
        }}
      >
        <div style={{ display: "flex", fontSize: 26, color: "#71717a" }}>
          carlos gomes / writing
        </div>
        <div
          style={{
            display: "flex",
            fontSize: post.title.length > 100 ? 42 : 56,
            lineHeight: 1.15,
            letterSpacing: -2,
            fontWeight: 700,
          }}
        >
          {post.title.toLowerCase()}
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "#71717a" }}>
          carlos.cv
        </div>
      </div>
      {image && (
        <img
          alt=""
          src={image}
          width={440}
          height={630}
          style={{ objectFit: "cover" }}
        />
      )}
    </div>,
    {
      width: 1200,
      height: 630,
      headers: { "Cache-Control": "public, max-age=300, s-maxage=300" },
    },
  );
}
