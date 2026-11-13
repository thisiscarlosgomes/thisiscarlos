import { connectToDatabase } from "@/lib/db";
import { BlogMedia } from "@/models/BlogMedia";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[a-f0-9]{24}$/.test(id)) return new Response(null, { status: 404 });
  await connectToDatabase();
  const media = await BlogMedia.findById(id);
  if (!media) return new Response(null, { status: 404 });
  const data = Buffer.from(media.data);
  const headers = {
    "Content-Type": media.mimeType,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  const range = req.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start = 0;
    let end = data.length - 1;
    if (match && (match[1] || match[2])) {
      if (match[1]) {
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), end) : end;
      } else start = Math.max(0, data.length - Number(match[2]));
    } else
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${data.length}` },
      });
    if (start > end || start >= data.length)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${data.length}` },
      });
    return new Response(new Uint8Array(data.subarray(start, end + 1)), {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${data.length}`,
      },
    });
  }
  return new Response(new Uint8Array(data), {
    headers: { ...headers, "Content-Length": String(data.length) },
  });
}
